const path = require('path');
const { awscdk } = require('projen');

const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Daniel Cousineau',
  authorAddress: 'dcousineau@gmail.com',
  description: 'A construct for working with RDS SQL servers. TEMP FORKED FROM mbonig/rds-tools',
  cdkVersion: '2.93.0',
  defaultReleaseBranch: 'main',
  jsiiFqn: 'dcousineau.rdsTools',
  name: '@dcousineau/rds-tools',
  homepage: 'https://github.com/dcousineau/rds-tools',
  repositoryUrl: 'https://github.com/dcousineau/rds-tools.git',
  jsiiVersion: '~5.5.0',
  // devDeps: [
  //   'eslint',
  //   'esbuild',
  // ],
  license: 'MIT',
  depsUpgrade: false,
  npmAccess: 'public',
  keywords: [
    'aws', 'awscdk', 'RDS', 'SQL',
  ],
  // publishToNuget: {
  //   dotNetNamespace: 'MBonig.RdsTools',
  //   packageId: 'MBonig.RdsTools',
  // },
  // publishToPypi: {
  //   distName: 'mbonig.rds-tools',
  //   module: 'mbonig.rds_tools',
  // },
});

// project.addFields({
//   awscdkio: {
//     twitter: 'mbonig',
//   },
// });

// project.gitignore.exclude('cdk.context.json', '.cdk.staging/', '.idea/', 'cdk.out/', 'npm-cache/');
// project.npmignore.exclude('cdk.context.json', '.cdk.staging/', '.idea/', 'cdk.out/');

// project.npmignore.include('./lib/handlers/*');

// project.compileTask.exec('cp src/handlers/*.ts lib/handlers/ && cp src/handlers/cfn-response.js lib/handlers/ && cp -R src/layer lib/layer && cp src/handlers/package* lib/handlers/');


project.synth();
