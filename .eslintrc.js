module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'airbnb-typescript',
    'plugin:@typescript-eslint/eslint-recommended',
  ],
  env: {
    node: true,
    jest: true,
    es6: true,
  },
  parserOptions: {
    project: [
      './tsconfig.eslint.json',
      './tsconfig.json',
    ],
    ecmaVersion: 2018,
    sourceType: 'module',
    tsconfigRootDir: __dirname,
  },
  rules: {
    'jest/no-focused-tests': 0,
    'class-methods-use-this': 0,
    'no-use-before-define': 0,
    'no-await-in-loop': 0,
    'no-underscore-dangle': 0,
    'import/no-extraneous-dependencies': ["off"],
    'import/prefer-default-export': 0,
    '@typescript-eslint/indent': ["error", 2],
    'global-require': 'warn',
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-explicit-any': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-use-before-define': 0,
    '@typescript-eslint/semi': 0,
    '@typescript-eslint/lines-between-class-members': 0,
    'object-curly-newline': 0,
    'arrow-body-style': 0,
    'arrow-parens': 0,
    'no-else-return': 0,
    'no-param-reassign': 0,
    'object-curly-spacing': ["error", "always"],
    '@typescript-eslint/naming-convention': ['error',
      {
        selector: 'variableLike',
        custom: {
          regex: '^([Aa]ny|[Nn]umber|[Ss]tring|[Bb]oolean|[Uu]ndefined)$',
          match: false,
        },
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'allow',
      },
      {
        selector: 'typeLike',
        custom: {
          regex: '^([Aa]ny|[Nn]umber|[Ss]tring|[Bb]oolean|[Uu]ndefined)$',
          match: false,
        },
        format: ['PascalCase'],
      },
    ],
    'max-len': ['error', 120],
    "operator-linebreak": ["error", "before"],
  },
  // silence dumb react warning
  settings: { react: { version: '999.999.999' } },
};
