/**
 * Per-sub-branch orStrategy selection via the pagination argument.
 *
 * Spec (2026-08-20): `orStrategy` rides the pagination element — the ROOT
 * pagination selects the strategy for the root query, and a relation field's
 * own `pagination` argument (`books(pagination: { orStrategy: OR })`) selects
 * the strategy for THAT sub-branch only (its inline filters, nested relation
 * filters, count/aggregate subqueries). Strategy inherits down the tree
 * (nearest-wins): a child without its own value inherits the query-level one.
 *
 * Effect zone: EXISTS subqueries built while mapping a branch's filters
 * (relation keys holding _or). The inline scalar _or inside a lateral
 * json_agg stays plain-OR always (PR #59 semantics — union-all there would
 * duplicate children matching 2+ branches).
 *
 * SQL-text assertions only — binding-value assertions false-pass on dropped
 * clauses (see inline-filter-position-parity.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setGlobalConfig } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Book } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('per-branch orStrategy via pagination', () => {
	let mapper: GQLtoSQLMapper;

	beforeEach(() => {
		mapper = new GQLtoSQLMapper(createMockMetadataProvider());
	});

	afterEach(() => {
		setGlobalConfig({ orStrategy: 'union-all' });
	});

	const build = (opts: any) => mapper.buildQueryAndBindingsFor(opts);

	// child filter with a RELATION key holding _or — generates an EXISTS whose
	// shape (union-all vs plain OR) reveals the strategy applied to the branch
	const authorWithBooks = (childPagination: any, childFilter: any, extra: any = {}) =>
		build({
			fields: {
				id: {},
				name: {},
				books: {
					fieldsByTypeName: {},
					args: {
						filter: childFilter,
						pagination: childPagination,
					},
				},
			},
			entity: Author,
			customFields: {},
			...extra,
		});

	const authorNameOr = { author: { _or: [{ name_eq: 'A' }, { name_eq: 'B' }] } };

	describe('child pagination selects the branch strategy', () => {
		it('child pagination.orStrategy "or" flattens the child-branch EXISTS', () => {
			const { querySQL } = authorWithBooks({ orStrategy: 'or' }, authorNameOr);

			expect(querySQL.toLowerCase()).toContain('exists');
			expect(querySQL.toLowerCase()).not.toContain('union all');
			// OR-combined: both bindings inside ONE exists with 'or' between
			expect(querySQL).toContain(') or (');
			expect(querySQL).toContain(':v_name_eq1_1');
			expect(querySQL).toContain(':v_name_eq2_1');
		});

		it('child pagination.orStrategy "union-all" keeps UNION ALL in the child-branch EXISTS', () => {
			const { querySQL } = authorWithBooks({ orStrategy: 'union-all' }, authorNameOr);

			expect(querySQL.toLowerCase()).toContain('union all');
		});

		it('child pagination.orStrategy "union-all" wins over query-level "or"', () => {
			const { querySQL } = authorWithBooks(
				{ orStrategy: 'union-all' },
				authorNameOr,
				{ pagination: { orStrategy: 'or' } }
			);

			// root asks 'or', the branch explicitly says 'union-all' → branch keeps UNION ALL
			expect(querySQL.toLowerCase()).toContain('union all');
		});
	});

	describe('inheritance: child without own value inherits the query strategy', () => {
		it('query-level "or" still reaches a child branch that has no pagination.orStrategy', () => {
			const { querySQL } = authorWithBooks({}, authorNameOr, {
				pagination: { orStrategy: 'or' },
			});

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL).toContain(') or (');
			expect(querySQL).toContain(':v_name_eq1_1');
		});

		it('global config still inherits into child branches when nothing else is set', () => {
			setGlobalConfig({ orStrategy: 'or' });
			const { querySQL } = authorWithBooks({}, authorNameOr);

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL).toContain(') or (');
		});
	});

	describe('sibling isolation (Book.characters vs Book.genres)', () => {
		it('two sibling branches with different strategies keep their own shapes', () => {
			const { querySQL } = build({
				fields: {
					id: {},
					title: {},
					characters: {
						fieldsByTypeName: {},
						args: {
							filter: { ring: { _or: [{ name_eq: 'Narya' }, { name_eq: 'Nenya' }] } },
							pagination: { orStrategy: 'or' },
						},
					},
					genres: {
						fieldsByTypeName: {},
						args: {
							filter: { books: { _or: [{ title_eq: 'A' }, { title_eq: 'B' }] } },
							pagination: { orStrategy: 'union-all' },
						},
					},
				},
				entity: Book,
				customFields: {},
			});

			// characters branch: OR-flattened EXISTS — ') or (' between ring names
			expect(querySQL).toContain(') or (');
			expect(querySQL).toContain(':v_name_eq1_1');
			expect(querySQL).toContain(':v_name_eq2_1');
			// genres branch: keeps UNION ALL
			expect(querySQL.toLowerCase()).toContain('union all');
		});
	});
});
