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
import { registerCountField } from '../../src/entities/gql-entity';
import { registerAggregateField } from '../../src/entities/gql-entity';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Fellowship, Person } from '../fixtures/middle-earth-schema';
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

	describe('count-field subquery', () => {
		it("orStrategy: 'or' flattens UNION ALL inside the COUNT subquery", () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					name: {},
					bookCount: {
						args: {
							filter: {
								_or: [{ title: 'The Hobbit' }, { title: 'The Lord of the Rings' }],
							},
						},
					},
				},
				entity: Author,
				customFields: {},
				pagination: { orStrategy: 'or' },
			} as any);

			expect(querySQL).toContain('count(*)');
			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});
	});

	describe('count-field subquery — union-all mode must not double-count', () => {
		it('projects child PKs and counts distinct so a child matching N branches counts once', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					name: {},
					bookCount: {
						args: {
							filter: {
								_or: [{ title: 'The Hobbit' }, { title: 'The Lord of the Rings' }],
							},
						},
					},
				},
				entity: Author,
				customFields: {},
			} as any);

			// Branches must project the child's PK columns, not the constant 1
			expect(querySQL).toContain('select e_w1.id as id');
			expect(querySQL).toContain('count(distinct');
			expect(querySQL).not.toContain('select 1 from');
			// single-column PK: distinct on the bare projected name
			expect(querySQL).toContain('count(distinct id)');
		});

		it('aggregate field with _or branches must not double-sum children', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const { querySQL } = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					name: {},
					totalPages: {
						args: {
							filter: {
								_or: [{ pages_gt: 300 }, { title: 'The Hobbit' }],
							},
						},
					},
				},
				entity: Author,
				customFields: {},
			} as any);

			// dedup happens via select-distinct over (PK, value) — NOT sum(distinct),
			// which would wrongly collapse equal values from different children
			expect(querySQL).toContain('select distinct id, value');
			expect(querySQL).toContain('sum(value)');
			expect(querySQL).not.toContain('select 1 from');
		});
	});
});
