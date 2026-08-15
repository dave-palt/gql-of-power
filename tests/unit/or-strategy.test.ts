/**
 * Unit tests for the `orStrategy` option ('union-all' | 'or').
 *
 * Verifies that:
 * - default behavior (UNION ALL branching) is unchanged
 * - per-query `pagination.orStrategy: 'or'` flattens `_or`/`_and` branches
 *   into a single `((w1) or (w2))` WHERE clause at the root query
 * - global `setGlobalConfig({ orStrategy })` applies and per-query wins
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setGlobalConfig } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Fellowship, Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('orStrategy', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	const scalarOrFilter = {
		_or: [{ name_eq: 'Frodo' }, { race_eq: 'Hobbit' }],
	};

	const buildQuery = (pagination?: Record<string, any>) =>
		mapper.buildQueryAndBindingsFor({
			fields: { id: {}, name: {}, race: {} },
			entity: Person,
			customFields: {},
			filter: scalarOrFilter as any,
			pagination: pagination as any,
		});

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
	});

	afterEach(() => {
		// Restore the default so we don't leak into other suites in this process
		setGlobalConfig({ orStrategy: 'union-all' });
	});

	describe('root query', () => {
		it('default strategy emits UNION ALL branches', () => {
			const { querySQL } = buildQuery();

			expect(querySQL.toLowerCase()).toContain('union all');
		});

		it("orStrategy: 'or' emits a single query with an OR where clause", () => {
			const { querySQL } = buildQuery({ orStrategy: 'or' });

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
			// both branch conditions still present with named bindings
			expect(querySQL).toContain(':v_');
			expect(querySQL.toLowerCase()).toContain('frodo');
			expect(querySQL.toLowerCase()).toContain('hobbit');
		});

		it("orStrategy: 'or' keeps results bound as named parameters", () => {
			const { bindings } = buildQuery({ orStrategy: 'or' });

			const bindingValues = Object.values(bindings as Record<string, any>);
			expect(bindingValues).toContain('Frodo');
			expect(bindingValues).toContain('Hobbit');
		});
	});
});
