module.exports = {
  globalSetup: './__tests__/helpers/setup.ts',
  roots: [
    '<rootDir>/__script_tests__',
    '<rootDir>/__tests__',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testRegex: '(__tests__|__script_tests__)\\/.*\\.test\\.ts$',
  moduleFileExtensions: [
    'ts',
    'js',
    'json',
    'node',
  ],
  moduleNameMapper: {
    axios: 'axios/dist/node/axios.cjs',
  },
  testPathIgnorePatterns: ['/node_modules/'],
  testEnvironment: 'node',
  testTimeout: 10000,
  reporters: ['default', 'jest-junit'],
};
