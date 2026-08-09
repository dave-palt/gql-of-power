/**
 * Unit Tests for Aggregate Field Feature
 *
 * Tests SQL generation for auto-generated aggregate fields (sum/avg/min/max) on
 * relationship properties. Aggregate fields produce correlated subqueries like
 * (SELECT SUM(pages) FROM books WHERE author_id = author.id).
 *
 * Also tests filtering by aggregate values (totalPages_gt: 500).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	clearAggregateFields,
	getAggregateFieldsFor,
	registerAggregateField,
} from '../../src/entities/gql-entity';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Book, Fellowship, Person, Region } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('Aggregate Field Feature', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
		clearAggregateFields();
	});

	afterEach(() => {
		clearAggregateFields();
	});

	describe('Aggregate field registration', () => {
		it('should register and retrieve aggregate fields', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');
			const fields = getAggregateFieldsFor('Author');
			expect(fields['totalPages']).toBeDefined();
			expect(fields['totalPages'].fn).toBe('sum');
			expect(fields['totalPages'].column).toBe('pages');
			expect(fields['totalPages'].relationshipFieldName).toBe('books');
			expect(fields['totalPages'].relatedEntityName()).toBe('Book');
		});

		it('should return empty object for entity with no aggregate fields', () => {
			const fields = getAggregateFieldsFor('Unknown');
			expect(Object.keys(fields).length).toBe(0);
		});

		it('should register multiple aggregate functions for the same relation', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');
			registerAggregateField('Author', 'avgPages', 'avg', 'pages', 'books', () => 'Book');
			registerAggregateField('Author', 'minPages', 'min', 'pages', 'books', () => 'Book');
			registerAggregateField('Author', 'maxPages', 'max', 'pages', 'books', () => 'Book');
			const fields = getAggregateFieldsFor('Author');
			expect(Object.keys(fields).length).toBe(4);
			expect(fields['totalPages'].fn).toBe('sum');
			expect(fields['avgPages'].fn).toBe('avg');
			expect(fields['minPages'].fn).toBe('min');
			expect(fields['maxPages'].fn).toBe('max');
		});
	});

	describe('SUM aggregate SQL generation - 1:m relationship', () => {
		it('should generate SUM(col) subquery for Author.totalPages', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, totalPages: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('page_count');
			expect(result.querySQL).toContain('"totalPages"');
			expect(result.querySQL).toContain('author_id');
		});
	});

	describe('AVG aggregate SQL generation - 1:m relationship', () => {
		it('should generate AVG(col) subquery for Author.avgPages', () => {
			registerAggregateField('Author', 'avgPages', 'avg', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, avgPages: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('avg(');
			expect(result.querySQL).toContain('page_count');
			expect(result.querySQL).toContain('"avgPages"');
		});
	});

	describe('MIN aggregate SQL generation - 1:m relationship', () => {
		it('should generate MIN(col) subquery for Author.oldestBookYear', () => {
			registerAggregateField(
				'Author',
				'oldestBookYear',
				'min',
				'publishedYear',
				'books',
				() => 'Book'
			);

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, oldestBookYear: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('min(');
			expect(result.querySQL).toContain('published_year');
			expect(result.querySQL).toContain('"oldestBookYear"');
		});
	});

	describe('MAX aggregate SQL generation - 1:m relationship', () => {
		it('should generate MAX(col) subquery for Author.newestBookYear', () => {
			registerAggregateField(
				'Author',
				'newestBookYear',
				'max',
				'publishedYear',
				'books',
				() => 'Book'
			);

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, newestBookYear: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('max(');
			expect(result.querySQL).toContain('published_year');
			expect(result.querySQL).toContain('"newestBookYear"');
		});
	});

	describe('Aggregate field filtering', () => {
		it('should filter by aggregate value with _gt operator', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Author,
				customFields: {},
				filter: { totalPages_gt: 500 } as any,
			});

			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('>');
			expect(result.querySQL).toContain(':v_totalPages');
			expect(result.bindings).toHaveProperty('v_totalPages1_1');
			expect(result.bindings.v_totalPages1_1).toBe(500);
		});

		it('should filter by aggregate value with _lte operator', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Author,
				customFields: {},
				filter: { totalPages_lte: 1000 } as any,
			});

			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('<=');
		});

		it('should filter by aggregate with implicit _eq', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Author,
				customFields: {},
				filter: { totalPages: 500 } as any,
			});

			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('=');
		});

		it('should filter by aggregate with nested object form', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Author,
				customFields: {},
				filter: { TotalPages: { _gt: 200, _lte: 800 } } as any,
			});

			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('>');
			expect(result.querySQL).toContain('<=');
		});
	});

	describe('Aggregate field edge cases', () => {
		it('should return null when related entity does not exist', () => {
			registerAggregateField('Author', 'badAgg', 'sum', 'pages', 'books', () => 'UnknownEntity');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, badAgg: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('null AS "badAgg"');
		});

		it('should return null when relationship field is invalid', () => {
			registerAggregateField('Author', 'badAgg', 'sum', 'pages', 'nonexistentRel', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, badAgg: {} } as any,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('null AS "badAgg"');
		});

		it('should resolve property name to SQL column name via metadata', () => {
			registerAggregateField('Author', 'totalPages', 'sum', 'pages', 'books', () => 'Book');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, totalPages: {} } as any,
				entity: Author,
				customFields: {},
			});

			// pages property maps to page_count SQL column
			expect(result.querySQL).toContain('page_count');
			expect(result.querySQL).not.toContain('.pages)');
		});
	});

	describe('Aggregate on m:m relationship', () => {
		it('should generate SUM subquery with pivot table join for m:m relations', () => {
			// Person -> battles is m:m
			registerAggregateField('Person', 'totalBattleIdSum', 'sum', 'id', 'battles', () => 'Battle');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {}, totalBattleIdSum: {} } as any,
				entity: Person,
				customFields: {},
			});

			// Should contain the SUM aggregate
			expect(result.querySQL).toContain('sum(');
			expect(result.querySQL).toContain('"totalBattleIdSum"');
		});
	});
});
