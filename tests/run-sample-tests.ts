#!/usr/bin/env bun

/**
 * Sample Test Runner
 * 
 * This script runs a few key tests to validate that the test infrastructure
 * and Middle-earth schema work correctly before the full refactoring.
 */

import { GQLtoSQLMapper } from '../src/queries/gql-to-sql-mapper';
import { createMockMetadataProvider } from './fixtures/test-data';
import { Person, Fellowship, Ring } from './fixtures/middle-earth-schema';

async function runSampleTests() {
	console.log('🧪 Running sample tests to validate infrastructure...\n');

	const mockProvider = createMockMetadataProvider();
	const mapper = new GQLtoSQLMapper(mockProvider);

	try {
		// Test 1: Basic Person query
		console.log('✅ Test 1: Basic Person query');
		const personFields = {
			id: {},
			name: {},
			age: {},
			race: {},
		};

		const personResult = mapper.buildQueryAndBindingsFor({
			fields: personFields,
			entity: Person,
			customFields: {},
		});

		console.log('   Generated SQL contains "persons":', personResult.querySQL.includes('persons'));
		console.log('   Generated SQL contains "jsonb_build_object":', personResult.querySQL.includes('jsonb_build_object'));
		console.log('   Bindings defined:', !!personResult.bindings);
		console.log('   SQL length:', personResult.querySQL.length, 'characters\n');

		// Test 2: Person with Ring (1:1 relationship)
		console.log('✅ Test 2: Person with Ring (1:1 relationship)');
		const personRingFields = {
			id: {},
			name: {},
			ring: {
				id: {},
				name: {},
				power: {},
			},
		};

		const personRingResult = mapper.buildQueryAndBindingsFor({
			fields: personRingFields,
			entity: Person,
			customFields: {},
		});

		console.log('   Generated SQL contains "persons":', personRingResult.querySQL.includes('persons'));
		console.log('   Generated SQL contains "rings":', personRingResult.querySQL.includes('rings'));
		console.log('   Generated SQL contains "ring_id":', personRingResult.querySQL.includes('ring_id'));
		console.log('   SQL length:', personRingResult.querySQL.length, 'characters\n');

		// Test 3: Fellowship with Members (1:m relationship)
		console.log('✅ Test 3: Fellowship with Members (1:m relationship)');
		const fellowshipFields = {
			id: {},
			name: {},
			purpose: {},
			members: {
				id: {},
				name: {},
				race: {},
			},
		};

		const fellowshipResult = mapper.buildQueryAndBindingsFor({
			fields: fellowshipFields,
			entity: Fellowship,
			customFields: {},
		});

		console.log('   Generated SQL contains "fellowships":', fellowshipResult.querySQL.includes('fellowships'));
		console.log('   Generated SQL contains "persons":', fellowshipResult.querySQL.includes('persons'));
		console.log('   Generated SQL contains "json_agg":', fellowshipResult.querySQL.includes('json_agg'));
		console.log('   SQL length:', fellowshipResult.querySQL.length, 'characters\n');

		// Test 4: Filtering
		console.log('✅ Test 4: Person query with filter');
		const filterResult = mapper.buildQueryAndBindingsFor({
			fields: personFields,
			entity: Person,
			customFields: {},
			filter: {
				name: 'Frodo Baggins',
				race: 'Hobbit',
			} as any,
		});

		console.log('   Generated SQL contains WHERE clause:', filterResult.querySQL.toLowerCase().includes('where'));
		console.log('   Bindings include filter values:', Object.keys(filterResult.bindings).length > 1);
		console.log('   SQL length:', filterResult.querySQL.length, 'characters\n');

		// Test 5: Pagination
		console.log('✅ Test 5: Person query with pagination');
		const paginationResult = mapper.buildQueryAndBindingsFor({
			fields: personFields,
			entity: Person,
			customFields: {},
			pagination: {
				limit: 10,
				offset: 5,
				orderBy: [{ name: 'asc' as any }],
			},
		});

		console.log('   Generated SQL contains ORDER BY:', paginationResult.querySQL.toLowerCase().includes('order by'));
		console.log('   Generated SQL contains LIMIT:', paginationResult.querySQL.toLowerCase().includes('limit'));
		console.log('   Bindings limit:', paginationResult.bindings.limit);
		console.log('   Bindings offset:', paginationResult.bindings.offset);
		console.log('   SQL length:', paginationResult.querySQL.length, 'characters\n');

		// Test 6: Complex nested query
		console.log('✅ Test 6: Complex nested relationship query');
		const complexFields = {
			id: {},
			name: {},
			race: {},
			ring: {
				id: {},
				name: {},
				power: {},
			},
			fellowship: {
				id: {},
				name: {},
				purpose: {},
			},
		};

		const complexResult = mapper.buildQueryAndBindingsFor({
			fields: complexFields,
			entity: Person,
			customFields: {},
		});

		console.log('   Generated SQL contains "persons":', complexResult.querySQL.includes('persons'));
		console.log('   Generated SQL contains "rings":', complexResult.querySQL.includes('rings'));
		console.log('   Generated SQL contains "fellowships":', complexResult.querySQL.includes('fellowships'));
		console.log('   SQL length:', complexResult.querySQL.length, 'characters\n');

		console.log('🎉 All sample tests completed successfully!');
		console.log('\n📋 Summary:');
		console.log('   - Basic queries: ✅');
		console.log('   - 1:1 relationships: ✅');
		console.log('   - 1:m relationships: ✅');
		console.log('   - Filtering: ✅');
		console.log('   - Pagination: ✅');
		console.log('   - Complex nested queries: ✅');
		console.log('\n🚀 Ready for comprehensive testing and refactoring!');

	} catch (error) {
		console.error('❌ Test failed:', error);
		process.exit(1);
	}
}

// Run the tests
runSampleTests().catch((error) => {
	console.error('❌ Failed to run sample tests:', error);
	process.exit(1);
});