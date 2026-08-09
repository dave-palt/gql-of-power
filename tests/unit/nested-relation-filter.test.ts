/**
 * Unit Tests for Multi-Level Nested Relation Filters
 *
 * Verifies that filter arguments on nested relation fields produce the
 * correct SQL with all JOINs resolved across every level of nesting.
 *
 * Example query shape under test:
 *   authors(filter: { books: { characters: { race_eq: 'Hobbit' } } } })
 *   Author  -> books (1:m)  -> characters (m:m) -> Person
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { AliasManager } from '../../src/queries/alias';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Book, Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('Multi-Level Nested Relation Filters (SQL generation)', () => {
	let provider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		provider = createMockMetadataProvider();
	});

	/**
	 * Build SQL for the given entity + filter and return the query string.
	 * No database round-trip — we only inspect the generated SQL.
	 */
	function buildSQL(entity: new () => any, filter: any): string {
		const aliasManager = new AliasManager();
		const mapper = new GQLtoSQLMapper(provider, { namedParameterPrefix: ':' });
		const { querySQL } = mapper.buildQueryAndBindingsFor({
			customFields: {} as any,
			fields: {} as any,
			entity,
			filter,
			pagination: {},
		});
		return querySQL;
	}

	it('Author -> books -> characters: 3-level nested m:m filter', () => {
		// "Find authors who wrote books containing Hobbit characters"
		// Author.books (1:m) -> Book.characters (m:m) -> Person.race
		const sql = buildSQL(Author, {
			books: {
				characters: {
					race_eq: 'Hobbit',
				},
			},
		});

		// Should reference all three tables
		expect(sql).toContain('authors');
		expect(sql).toContain('books');
		expect(sql).toContain('persons');

		// Should reference the m:m junction table for Book <-> Person
		expect(sql).toContain('book_characters');

		// Should contain a parameter binding for the filter value
		expect(sql).toContain(':v_race_eq');
	});

	it('Author -> books: 2-level nested 1:m filter with scalar condition', () => {
		const sql = buildSQL(Author, {
			books: {
				title_eq: 'The Fellowship of the Ring',
			},
		});

		expect(sql).toContain('authors');
		expect(sql).toContain('books');
		expect(sql).toContain('book_title');
		expect(sql).toContain(':v_title_eq');
	});

	it('Book -> characters -> fellowship: mixed m:m + m:1 nesting', () => {
		// Book.characters (m:m) -> Person.fellowship (m:1) -> Fellowship.name
		const sql = buildSQL(Book, {
			characters: {
				fellowship: {
					name_eq: 'Fellowship of the Ring',
				},
			},
		});

		expect(sql).toContain('books');
		expect(sql).toContain('persons');
		expect(sql).toContain('fellowships');
		expect(sql).toContain('book_characters');
	});

	it('Person -> battles -> warriors: symmetric m:m nesting (both sides m:m)', () => {
		// Person.battles (m:m) -> Battle.warriors (m:m) -> Person.name
		const sql = buildSQL(Person, {
			battles: {
				warriors: {
					name_eq: 'Aragorn',
				},
			},
		});

		expect(sql).toContain('persons');
		expect(sql).toContain('battles');
		expect(sql).toContain('person_battles');
	});

	it('_and with nested relation filter: Author -> books AND Author.name', () => {
		const sql = buildSQL(Author, {
			_and: [
				{ name_eq: 'J.R.R. Tolkien' },
				{
					books: {
						pages_gt: 300,
					},
				},
			],
		});

		expect(sql).toContain('authors');
		expect(sql).toContain('books');
	});
});
