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
			// both branch conditions combined with OR, bound as named parameters
			expect(querySQL.toLowerCase()).toContain(' or ');
			expect(querySQL).toContain(':v_name_eq');
			expect(querySQL).toContain(':v_race_eq');
		});
	});

	describe('global config + precedence', () => {
		it('global setGlobalConfig({ orStrategy: "or" }) applies without per-query override', () => {
			setGlobalConfig({ orStrategy: 'or' });

			const { querySQL } = buildQuery();

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});

		it('per-query orStrategy overrides the global setting', () => {
			setGlobalConfig({ orStrategy: 'or' });

			const { querySQL } = buildQuery({ orStrategy: 'union-all' });

			expect(querySQL.toLowerCase()).toContain('union all');
		});
	});

	describe('EXISTS relationship filter paths', () => {
		const personFields = { id: {}, name: {} };

		it('m:1 relationship filter with nested _or uses plain OR inside EXISTS', () => {
			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: personFields,
				entity: Person,
				customFields: {},
				filter: {
					Fellowship: { _or: [{ name_eq: 'Fellowship of the Ring' }, { name_eq: 'The Nine' }] },
				} as any,
				pagination: { orStrategy: 'or' },
			});

			expect(querySQL.toLowerCase()).toContain('exists');
			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});

		it('1:m relationship filter with nested _or uses plain OR inside EXISTS', () => {
			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} },
				entity: Fellowship,
				customFields: {},
				filter: {
					members: { _or: [{ name_eq: 'Frodo' }, { name_eq: 'Gandalf' }] },
				} as any,
				pagination: { orStrategy: 'or' },
			});

			expect(querySQL.toLowerCase()).toContain('exists');
			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});

		it('m:m relationship filter with nested _or uses plain OR inside EXISTS', () => {
			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: personFields,
				entity: Person,
				customFields: {},
				filter: {
					battles: { _or: [{ name_eq: 'Helms Deep' }, { name_eq: 'Pelennor' }] },
				} as any,
				pagination: { orStrategy: 'or' },
			});

			expect(querySQL.toLowerCase()).toContain('exists');
			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});

		it('default strategy still uses UNION ALL inside relationship EXISTS', () => {
			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: personFields,
				entity: Person,
				customFields: {},
				filter: {
					Fellowship: { _or: [{ name_eq: 'Fellowship of the Ring' }, { name_eq: 'The Nine' }] },
				} as any,
			});

			expect(querySQL.toLowerCase()).toContain('exists');
			expect(querySQL.toLowerCase()).toContain('union all');
		});
	});
});
