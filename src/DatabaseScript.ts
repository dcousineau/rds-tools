import { execSync, ExecSyncOptions } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import {
  aws_ec2 as ec2,
  aws_lambda,
  aws_lambda_nodejs,
  aws_logs,
  aws_rds,
  aws_secretsmanager,
  CustomResource,
  Duration,
  Stack,
} from 'aws-cdk-lib';
import { Connections, IConnectable, IVpc } from 'aws-cdk-lib/aws-ec2';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseScriptProps {

  /**
   * The VPC for the Lambda Function to attach to. If one is not provide, it's assumed from the database instance.
   */
  readonly vpc?: ec2.IVpc;

  /**
   * An optional databaseName. If none is provided then it will be the default for the rds instance, as defined by the AWS docs.
   *
   * mysql - mysql
   * mssql - master
   * postgres - postgres
   *
   */
  readonly databaseName?: string;

  /**
   * The database instance to run the script against
   */
  readonly databaseInstance?: aws_rds.DatabaseInstance;

  /**
   * An optional secret that provides credentials for the database. Must have fields 'username' and 'password'
   *
   * @default the root secret from the database instance
   */
  readonly secret?: aws_secretsmanager.ISecret;

  /**
   * The script to execute.
   */
  readonly script: string;

  /**
   * Deploy a second Lambda function that allows for adhoc sql against the database?
   *
   * @default false
   */
  readonly enableAdhoc?: boolean;
}

export class DatabaseScript extends Construct implements IConnectable {

  /**
   * The underlying Lambda handler function for making adhoc commands against the database.
   * Undefined unless 'enableAdhoc' is true
   */
  adhocHandler?: aws_lambda.IFunction;
  readonly handler: aws_lambda.IFunction;
  private readonly providerLayer: aws_lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: DatabaseScriptProps) {
    super(scope, id);

    const secret = props.secret || props.databaseInstance?.secret;
    if (!secret) {
      throw new Error('You must either provide a secret or there must be one available on the databaseInstance');
    }

    const vpc = props.vpc || props.databaseInstance?.vpc;
    if (!vpc) {
      throw new Error('Please provide a VPC to use, either on the `vpc` prop or via the `databaseInstance` prop.');
    }

    const assetPath = path.join(__dirname, 'layer');
    this.providerLayer = new aws_lambda.LayerVersion(this, `${id}-deps-layer`, {
      code: aws_lambda.Code.fromAsset(assetPath, {
        bundling: {
          image: aws_lambda.Runtime.NODEJS_18_X.bundlingImage,
          user: 'root',
          command: [
            'sh', '-c',
            [
              'cd $(mktemp -d)',
              'cp /asset-input/* .',
              'npm ci',
              'cp -r ./node_modules ./dist/* /asset-output/',
            ].join(' && '),
          ],
          environment: {
            npm_config_cache: '/tmp/npm_cache',
            npm_config_update_notifier: 'false',
          },
          workingDirectory: '/asset-input/nodejs',
          local: {
            tryBundle(outputDir: string): boolean {
              console.log('Going to try local bundling...');
              if (os.platform() !== 'linux') {
                console.warn('When using local bundling on another OS besides linux, you may end up building dependencies that will not run on AWS Lambda. Please build on a linux OS if you run into issues.');
              }
              const execOptions: ExecSyncOptions = { stdio: ['ignore', process.stderr, 'inherit'] };
              try {
                const layerDir = path.join(__dirname, 'layer');
                execSync('npm install', {
                  ...execOptions,
                  cwd: path.join(layerDir, 'nodejs'),
                });
                execSync(`mkdir -p ${outputDir}/nodejs/node_modules`, { ...execOptions });
                execSync(`cp -r ${layerDir}/nodejs/node_modules/* ${outputDir}/nodejs/node_modules`, { ...execOptions });

              } catch {
                return false;
              }
              return true;
            },
          },
        },
      }),
    });

    const handler = this.handler = this.createLambda('cr', props, vpc, secret);
    new CustomResource(this, `${id}-customResource`, {
      serviceToken: handler.functionArn,
      properties: {
        script: props.script,
        databaseName: props.databaseName,
      },
    });

    if (props.enableAdhoc) {
      this.adhocHandler = this.createLambda('adhoc', props, vpc, secret, 'adhocHandler');
    }

  }

  get connections(): Connections {
    return this.handler.connections;
  }

  get adhocConnections(): Connections {
    if (!this.adhocHandler) {
      throw new Error('Please enable the adhoc handler using the enableAdhoc prop.');
    }
    return this.adhocHandler?.connections;
  }

  /**
   * Grants access to the Lambda Function to the given SecurityGroup.
   * Adds an ingress rule to the given security group and for the given port.
   * @deprecated Do not use, pass this construct as an IConnectable
   * @param securityGroup
   * @param port
   */
  bind(securityGroup: ec2.SecurityGroup, port: ec2.Port): DatabaseScript {
    securityGroup.addIngressRule(this.handler.connections.securityGroups[0], port, 'access from Lambda ' + this.handler.node.id);
    return this;
  }

  slugify(x: string): string {
    return x.replace(/[^a-zA-Z0-9]/g, '');
  }

  private createLambda(id: string, props: DatabaseScriptProps, vpc: IVpc, secret: ISecret, handler?: string) {
    const handlerFunction = this.ensureLambda(`${props.databaseInstance?.node.id ?? props.secret?.node.id}-${id}`, {
      entry: path.join(__dirname, 'handlers', 'index.ts'),
      depsLockFilePath: path.join(__dirname, 'handlers', 'package-lock.json'),
      handler: handler ?? 'handler',
      runtime: aws_lambda.Runtime.NODEJS_18_X,
      vpc: vpc,
      environment: {
        SECRET_ARN: secret.secretArn,
      },
      bundling: {
        externalModules: ['@aws-sdk/client-secrets-manager', 'mssql', 'promise-mysql', 'pg'],
      },
      timeout: Duration.seconds(15), // TODO: should be overridable
      logRetention: aws_logs.RetentionDays.ONE_DAY,
    });

    handlerFunction.addLayers(this.providerLayer);

    secret.grantRead(handlerFunction);
    return handlerFunction;
  }

  private ensureLambda(id: string, props: aws_lambda_nodejs.NodejsFunctionProps): aws_lambda_nodejs.NodejsFunction {
    // TODO: Copy-pasted from CDK codebase until
    //       https://github.com/aws/aws-cdk/issues/6261 is fixed and we can
    //       use a proper SingletonFunction
    const constructName = this.slugify(id) + 'singl';
    const existing = Stack.of(this).node.tryFindChild(constructName);
    if (existing) {
      return existing as aws_lambda_nodejs.NodejsFunction;
    }
    return new aws_lambda_nodejs.NodejsFunction(Stack.of(this), constructName, props);
  }
}
