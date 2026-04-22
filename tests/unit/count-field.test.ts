/**
 * Unit Tests for Count Field Feature
 *
 * Tests the SQL generation for auto-generated count fields on relationship properties.
 * Count fields produce correlated COUNT(*) subqueries with optional filter support.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	clearCountFields,
	getCountFieldsFor,
	registerCountField,
} from '../../src/entities/gql-entity';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Battle, Book, Fellowship, Person, Region } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('Count Field Feature', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
		clearCountFields();
	});

	afterEach(() => {
		clearCountFields();
	});

	describe('Count field registration', () => {
		it('should register and retrieve count fields', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');
			const countFields = getCountFieldsFor('Author');
			expect(countFields['bookCount']).toBeDefined();
			expect(countFields['bookCount'].relationshipFieldName).toBe('books');
			expect(countFields['bookCount'].relatedEntityName()).toBe('Book');
		});

		it('should return empty object for entity with no count fields', () => {
			const countFields = getCountFieldsFor('Unknown');
			expect(Object.keys(countFields).length).toBe(0);
		});
	});

	describe('Count field SQL generation - 1:m relationship', () => {
		it('should generate COUNT(*) subquery for Author.bookCount', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = {
				id: {},
				name: {},
				bookCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('authors');
			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('"bookCount"');
			expect(result.bindings).toBeDefined();
		});

		it('should generate correct join condition for 1:m count', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = {
				id: {},
				name: {},
				bookCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('author_id');
			expect(result.querySQL).toContain('id');
			expect(result.querySQL).toMatch(/count\(\*\).*as.*"bookCount"/i);
		});
	});

	describe('Count field SQL generation - m:m relationship', () => {
		it('should generate COUNT(*) subquery with pivot table for Person.battleCount', () => {
			registerCountField('Person', 'battleCount', 'battles', () => 'Battle');

			const fields = {
				id: {},
				name: {},
				battleCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL).toContain('"battleCount"');
		});
	});

	describe('Count field SQL generation - 1:m (Fellowship)', () => {
		it('should generate COUNT(*) subquery for Fellowship.memberCount', () => {
			registerCountField('Fellowship', 'memberCount', 'members', () => 'Person');

			const fields = {
				id: {},
				name: {},
				memberCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowship_id');
			expect(result.querySQL).toContain('"memberCount"');
		});
	});

	describe('Count field with filter args', () => {
		it('should apply filter conditions within the COUNT subquery', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = {
				id: {},
				name: {},
				bookCount: {
					args: {
						filter: {
							title: 'The Hobbit',
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('"bookCount"');
			expect(result.querySQL.toLowerCase()).toContain('title');
		});

		it('should apply operator filters within the COUNT subquery', () => {
			registerCountField('Fellowship', 'memberCount', 'members', () => 'Person');

			const fields = {
				id: {},
				name: {},
				memberCount: {
					args: {
						filter: {
							age_gt: 80,
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('age');
			expect(result.querySQL).toContain('>');
			expect(result.bindings).toBeDefined();
		});

		it('should handle _or filter within the COUNT subquery', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = {
				id: {},
				name: {},
				bookCount: {
					args: {
						filter: {
							_or: [{ title: 'The Hobbit' }, { title: 'The Lord of the Rings' }],
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL.toLowerCase()).toContain('union all');
		});
	});

	describe('Count field alongside regular fields', () => {
		it('should work alongside regular relationship fields', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = {
				id: {},
				name: {},
				bookCount: {},
				books: {
					fieldsByTypeName: {
						Book: {
							id: {},
							title: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('"bookCount"');
			expect(result.querySQL).toContain('json_agg');
			expect(result.querySQL).toContain('books');
		});

		it('should work with multiple count fields', () => {
			registerCountField('Region', 'locationCount', 'locations', () => 'Location');

			const fields = {
				id: {},
				name: {},
				locationCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
			});

			expect(result.querySQL).toContain('count(*)');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('"locationCount"');
		});
	});

	describe('Count field edge cases', () => {
		it('should return 0 when related entity metadata is not found', () => {
			registerCountField('Author', 'unknownCount', 'unknownRel', () => 'UnknownEntity');

			const fields = {
				id: {},
				name: {},
				unknownCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('0 AS "unknownCount"');
		});

		it('should return 0 when relationship field is not found in metadata', () => {
			registerCountField('Author', 'fakeCount', 'nonexistentRel', () => 'Book');

			const fields = {
				id: {},
				name: {},
				fakeCount: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('0 AS "fakeCount"');
		});
	});

	describe('Count field as filter', () => {
		it('should filter by count equality (implicit _eq)', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = { bookCount: 5 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('books');
			expect(result.bindings).toBeDefined();
		});

		it('should filter by count with _eq operator', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = { bookCount_eq: 3 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('books');
		});

		it('should filter by count with _gt operator', () => {
			registerCountField('Fellowship', 'memberCount', 'members', () => 'Person');

			const fields = { id: {}, name: {} };
			const filter = { memberCount_gt: 5 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('>');
			expect(result.querySQL).toContain('persons');
		});

		it('should filter by count with _lt operator', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = { bookCount_lt: 10 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('<');
		});

		it('should filter by count with _gte and _lte operators', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = { bookCount_gte: 2, bookCount_lte: 10 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('>=');
			expect(result.querySQL).toContain('<=');
		});

		it('should filter by count with nested object form', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = { BookCount: { _gt: 3 } };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('>');
		});

		it('should filter by count with m:m relationship', () => {
			registerCountField('Person', 'battleCount', 'battles', () => 'Battle');

			const fields = { id: {}, name: {} };
			const filter = { battleCount_gt: 2 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('>');
		});

		it('should combine count filter with other filters in _and', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = {
				_and: [{ bookCount_gt: 2 }, { name: 'Tolkien' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL.toLowerCase()).toContain('author_name');
		});

		it('should combine count filter with _or', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {} };
			const filter = {
				_or: [{ bookCount_gt: 10 }, { bookCount_eq: 0 }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL.toLowerCase()).toContain('union all');
		});

		it('should select and filter by count simultaneously', () => {
			registerCountField('Author', 'bookCount', 'books', () => 'Book');

			const fields = { id: {}, name: {}, bookCount: {} };
			const filter = { bookCount_gt: 2 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('"bookCount"');
			expect(result.querySQL.toLowerCase()).toContain('count(*)');
			expect(result.querySQL).toContain('>');
		});
	});
});
