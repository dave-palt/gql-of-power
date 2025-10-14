// This file is kept for compatibility but bunjs uses its built-in test runner
// Configuration is handled in bunfig.toml or package.json
// Run tests with: bun test

module.exports = {
	// Legacy Jest config - bunjs will use its own test runner
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
