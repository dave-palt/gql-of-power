/**
 * Test Setup for bunjs
 * 
 * This file configures the test environment for bunjs test runner.
 * It sets up any global configurations, mocks, or utilities needed across tests.
 */

// Import reflect-metadata for TypeGraphQL decorators
import 'reflect-metadata';

// Set up environment variables for testing
if (!process.env.NODE_ENV) {
	process.env.NODE_ENV = 'test';
}

// Disable verbose console logging during tests unless explicitly enabled
if (!process.env.VERBOSE_TESTS) {
	// Keep error logging but reduce noise from console.time/timeLog
	const originalConsoleTime = console.time;
	const originalConsoleTimeLog = console.timeLog;
	const originalConsoleTimeEnd = console.timeEnd;

	console.time = () => {}; // No-op
	console.timeLog = () => {}; // No-op
	console.timeEnd = () => {}; // No-op

	// Restore original methods if needed for debugging
	(global as any).restoreConsoleTimers = () => {
		console.time = originalConsoleTime;
		console.timeLog = originalConsoleTimeLog;
		console.timeEnd = originalConsoleTimeEnd;
	};
}

// Set default test timeout for longer-running integration tests
const DEFAULT_TEST_TIMEOUT = 10000; // 10 seconds

// Global test utilities
(global as any).testUtils = {
	timeout: DEFAULT_TEST_TIMEOUT,
	
	// Helper to create mock GraphQL info object
	createMockInfo: (fieldName: string = 'testField') => ({
		fieldName,
		fieldNodes: [],
		returnType: {},
		parentType: {},
		path: {},
		schema: {},
		fragments: {},
		rootValue: {},
		operation: {},
		variableValues: {},
	}),
	
	// Helper to wait for async operations in tests
	wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
	
	// Helper to generate test data variations
	generateTestVariations: <T>(base: T, variations: Partial<T>[]): T[] => {
		return variations.map(variation => ({ ...base, ...variation }));
	},
};

// Configure test database environment for string/jsonb modes
export const testEnvironments = {
	jsonb: () => {
		delete process.env.D3GOP_USE_STRING_FOR_JSONB;
	},
	
	stringConcat: () => {
		process.env.D3GOP_USE_STRING_FOR_JSONB = 'true';
	},
};

// Export common test constants
export const TEST_CONSTANTS = {
	SAMPLE_ENTITIES: {
		PERSON: 'Person',
		RING: 'Ring',
		FELLOWSHIP: 'Fellowship',
		QUEST: 'Quest',
		LOCATION: 'Location',
		REGION: 'Region',
		BATTLE: 'Battle',
		ARMY: 'Army',
		BOOK: 'Book',
		AUTHOR: 'Author',
		GENRE: 'Genre',
	},
	
	SAMPLE_DATA: {
		FRODO_ID: 1,
		GANDALF_ID: 2,
		ARAGORN_ID: 3,
		ONE_RING_ID: 1,
		FELLOWSHIP_ID: 1,
	},
	
	RELATIONSHIP_TYPES: {
		ONE_TO_ONE: '1:1',
		ONE_TO_MANY: '1:m',
		MANY_TO_ONE: 'm:1',
		MANY_TO_MANY: 'm:m',
	},
} as const;

// Helper functions for test data validation
export const testHelpers = {
	/**
	 * Validates that a SQL query contains expected elements
	 */
	validateSQLQuery: (sql: string, expectedElements: string[]) => {
		const lowerSQL = sql.toLowerCase();
		const missing = expectedElements.filter(element => 
			!lowerSQL.includes(element.toLowerCase())
		);
		
		if (missing.length > 0) {
			throw new Error(`SQL query missing expected elements: ${missing.join(', ')}\nSQL: ${sql}`);
		}
		
		return true;
	},
	
	/**
	 * Validates query bindings have expected structure
	 */
	validateBindings: (bindings: any, expectedKeys?: string[]) => {
		if (!bindings || typeof bindings !== 'object') {
			throw new Error('Bindings should be a valid object');
		}
		
		if (expectedKeys) {
			const missing = expectedKeys.filter(key => !(key in bindings));
			if (missing.length > 0) {
				throw new Error(`Bindings missing expected keys: ${missing.join(', ')}`);
			}
		}
		
		return true;
	},
	
	/**
	 * Creates a standardized test field structure
	 */
	createTestFields: (entityType: string, includeRelations: boolean = false) => {
		const baseFields = {
			id: {},
			name: {},
		};
		
		if (!includeRelations) {
			return baseFields;
		}
		
		// Add relationship fields based on entity type
		switch (entityType) {
			case 'Person':
				return {
					...baseFields,
					age: {},
					race: {},
					ring: { id: {}, name: {} },
					fellowship: { id: {}, name: {} },
					battles: { id: {}, name: {} },
				};
			case 'Fellowship':
				return {
					...baseFields,
					purpose: {},
					members: { id: {}, name: {}, race: {} },
					quest: { id: {}, name: {} },
				};
			default:
				return baseFields;
		}
	},
	
	/**
	 * Creates test filters for different scenarios
	 */
	createTestFilters: (filterType: 'simple' | 'complex' | 'relationship') => {
		switch (filterType) {
			case 'simple':
				return { name: 'Frodo' };
			case 'complex':
				return {
					_or: [
						{ name: 'Frodo' },
						{ _and: [{ race: 'Hobbit' }, { age: { _lt: 50 } }] },
					],
				};
			case 'relationship':
				return {
					fellowship: { name: 'Fellowship of the Ring' },
				};
			default:
				return {};
		}
	},
};

console.log('🧪 Test environment initialized for bunjs');
console.log(`📝 NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`🎯 Test timeout: ${DEFAULT_TEST_TIMEOUT}ms`);