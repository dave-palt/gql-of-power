/**
 * Regression tests: inline filters must behave identically regardless of
 * WHERE in the query they appear ("filter position parity").
 *
 * The bug: `authors { books(filter: { _or: [...] }) }` silently dropped the
 * `_or`/`_and` from generated SQL on plain relation fields — ALL cardinalities
 * (1:m, m:m, m:1), while the same filters worked at root level and via custom
 * fields with `requiresRelations`. Verified as never-worked (present at the
 * commit that introduced inline filters, #41).
 *
 * m:1 was additionally hidden by a false-positive test (binding-value
 * assertions): the mappings reducer merges `values` from `_or`/`_and` branch
 * mappings even when their WHERE clauses are dropped, so converted enum
 * bindings leaked into the executed query while the filter itself vanished.
 *
 * These tests assert on the SQL TEXT (not bindings) because "filter silently
 * dropped" bugs are invisible to binding-value assertions.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Genre, Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('inline filter position parity — plain relation fields', () => {
	let mapper: GQLtoSQLMapper;

	beforeEach(() => {
		mapper = new GQLtoSQLMapper(createMockMetadataProvider());
	});

	const buildAuthorBooksQuery = (filter: unknown) =>
		mapper.buildQueryAndBindingsFor({
			fields: {
				id: {},
				name: {},
				books: {
					args: { filter: filter as any },
					fieldsByTypeName: { Book: { id: {}, title: {} } },
				},
			} as any,
			entity: Author,
			customFields: {},
		} as any);

	const buildGenreBooksQuery = (filter: unknown) =>
		mapper.buildQueryAndBindingsFor({
			fields: {
				id: {},
				name: {},
				books: {
					args: { filter: filter as any },
					fieldsByTypeName: { Book: { id: {}, title: {} } },
				},
			} as any,
			entity: Genre,
			customFields: {},
		} as any);

	const buildPersonRingQuery = (filter: unknown) =>
		mapper.buildQueryAndBindingsFor({
			fields: {
				id: {},
				ring: {
					args: { filter: filter as any },
					fieldsByTypeName: { Ring: { id: {}, name: {} } },
				},
			} as any,
			entity: Person,
			customFields: {},
		} as any);

	// ── 1:m ────────────────────────────────────────────────────────────────

	it('1:m: inline _or filter lands in the child WHERE (orStrategy union-all default)', () => {
		const { querySQL } = buildAuthorBooksQuery({
			_or: [{ title_eq: 'Fellowship' }, { pages_gt: 300 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_title_eq');
		expect(sql).toContain(':v_pages_gt');
		// both branches must be combined INSIDE the child's lateral subquery,
		// combined with OR — not dropped
		expect(sql).toContain(' or ');
	});

	it('1:m: inline _and filter lands in the child WHERE', () => {
		const { querySQL } = buildAuthorBooksQuery({
			_and: [{ title_eq: 'Fellowship' }, { pages_gt: 300 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_title_eq');
		expect(sql).toContain(':v_pages_gt');
		// _and branches are flattened with AND semantics
		expect(sql).toContain(' and ');
	});

	// ── m:m ────────────────────────────────────────────────────────────────

	it('m:m: inline _or filter lands in the child WHERE', () => {
		const { querySQL } = buildGenreBooksQuery({
			_or: [{ title_eq: 'Fellowship' }, { pages_gt: 300 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_title_eq');
		expect(sql).toContain(':v_pages_gt');
		expect(sql).toContain(' or ');
	});

	it('m:m: inline _and filter lands in the child WHERE', () => {
		const { querySQL } = buildGenreBooksQuery({
			_and: [{ title_eq: 'Fellowship' }, { pages_gt: 300 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_title_eq');
		expect(sql).toContain(':v_pages_gt');
		expect(sql).toContain(' and ');
	});

	// ── m:1 ────────────────────────────────────────────────────────────────

	it('m:1: inline _or filter lands in the child WHERE', () => {
		const { querySQL } = buildPersonRingQuery({
			_or: [{ name_eq: 'Nenya' }, { power_gt: 5 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_name_eq');
		expect(sql).toContain(':v_power_gt');
		expect(sql).toContain(' or ');
	});

	it('m:1: inline _and filter lands in the child WHERE', () => {
		const { querySQL } = buildPersonRingQuery({
			_and: [{ name_eq: 'Nenya' }, { power_gt: 5 }],
		});
		const sql = querySQL.toLowerCase();

		expect(sql).toContain(':v_name_eq');
		expect(sql).toContain(':v_power_gt');
		expect(sql).toContain(' and ');
	});
});
