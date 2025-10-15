/**
 * Integration Tests for GQLtoSQLMapper - Relationship Scenarios
 *
 * These tests verify that the GQLtoSQLMapper correctly handles all types
 * of relationships and complex query scenarios using Middle-earth entities.
 */

import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { GQLQueryManager } from '../../src/query-manager';
import { Battle, Book, Fellowship, Person, Region, Ring } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('GQLtoSQLMapper - Relationship Integration Tests', () => {
	let mapper: GQLtoSQLMapper;
	let queryManager: GQLQueryManager;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
		queryManager = new GQLQueryManager();
	});

	describe('1:1 Relationships (Person <-> Ring)', () => {
		it('should handle Person to Ring relationship', () => {
			const fields = {
				id: {},
				name: {},
				ring: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});
			console.log('query ->', result.querySQL);

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('row_to_json');
			expect(result.querySQL).toContain('bearer_id');
			expect(result.querySQL).toContain('person_name AS "name"');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Ring to Person (bearer) relationship', () => {
			const fields = {
				id: {},
				name: {},
				power: {},
				bearer: {
					id: {},
					name: {},
					race: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Ring,
				customFields: {},
			});

			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('bearer_id');
			expect(result.bindings).toBeDefined();
		});

		it('should filter 1:1 relationships correctly', () => {
			const fields = {
				id: {},
				name: {},
				ring: {
					id: {},
					name: {},
				},
			};

			const filter = {
				ring: {
					name: 'The One Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('1:m Relationships (Fellowship -> Members, Region -> Locations)', () => {
		it('should handle Fellowship to Members (1:m) relationship', () => {
			const fields = {
				id: {},
				name: {},
				purpose: {},
				members: {
					id: {},
					name: {},
					race: {},
					age: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowship_id');
			expect(result.querySQL).toContain('json_agg');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Region to Locations (1:m) relationship', () => {
			const fields = {
				id: {},
				name: {},
				ruler: {},
				locations: {
					id: {},
					name: {},
					type: {},
					description: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
			});

			expect(result.querySQL).toContain('regions');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('region_id');
			expect(result.querySQL).toContain('json_agg');
			expect(result.bindings).toBeDefined();
		});

		it('should filter 1:m relationships with pagination', () => {
			const fields = {
				id: {},
				name: {},
				members: {
					id: {},
					name: {},
					race: {},
				},
			};

			const filter = {
				members: {
					race: 'Hobbit',
				},
			};

			const pagination = {
				limit: 5,
				orderBy: [{ name: 'asc' as any }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
				filter: filter as any,
				pagination,
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.bindings.limit).toBe(5);
			expect(result.querySQL.toLowerCase()).toContain('order by');
		});
	});

	describe('m:1 Relationships (Person -> Fellowship, Book -> Author)', () => {
		it('should handle Person to Fellowship (m:1) relationship', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				fellowship: {
					id: {},
					name: {},
					purpose: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('fellowship_id');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Book to Author (m:1) relationship', () => {
			const fields = {
				id: {},
				title: {},
				publishedYear: {},
				author: {
					id: {},
					name: {},
					birthYear: {},
					nationality: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Book,
				customFields: {},
			});

			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('authors');
			expect(result.querySQL).toContain('author_id');
			expect(result.bindings).toBeDefined();
		});

		it('should filter m:1 relationships correctly', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
				},
			};

			const filter = {
				fellowship: {
					name: 'Fellowship of the Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL.toLowerCase()).toContain('where');
		});
	});

	describe('m:m Relationships (Person <-> Battle, Book <-> Genre)', () => {
		it('should handle Person to Battles (m:m) relationship', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				battles: {
					id: {},
					name: {},
					date: {},
					outcome: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL).toContain('json_agg');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Battle to Warriors (m:m) relationship', () => {
			const fields = {
				id: {},
				name: {},
				date: {},
				outcome: {},
				warriors: {
					id: {},
					name: {},
					race: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Battle,
				customFields: {},
			});

			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL).toContain('json_agg');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Book to Genres (m:m) relationship', () => {
			const fields = {
				id: {},
				title: {},
				genres: {
					id: {},
					name: {},
					description: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Book,
				customFields: {},
			});

			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('genres');
			expect(result.querySQL).toContain('book_genres');
			expect(result.querySQL).toContain('json_agg');
			expect(result.bindings).toBeDefined();
		});

		it('should filter m:m relationships with complex conditions', () => {
			const fields = {
				id: {},
				name: {},
				battles: {
					id: {},
					name: {},
					outcome: {},
				},
			};

			const filter = {
				battles: {
					outcome: 'Victory',
					casualties: { _lt: 1000 },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL.toLowerCase()).toContain('where');
		});
	});

	describe('Nested Relationships (Multi-level)', () => {
		it('should handle deeply nested relationships', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
					quest: {
						id: {},
						name: {},
						description: {},
						locations: {
							id: {},
							name: {},
							region: {
								id: {},
								name: {},
								ruler: {},
							},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('quests');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('regions');
			expect(result.bindings).toBeDefined();
		});

		it('should handle mixed relationship types in single query', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				// 1:1 relationship
				ring: {
					id: {},
					name: {},
					power: {},
				},
				// m:1 relationship
				fellowship: {
					id: {},
					name: {},
					purpose: {},
				},
				// m:m relationship
				battles: {
					id: {},
					name: {},
					outcome: {},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('Complex Filtering Scenarios', () => {
		it('should handle OR conditions across multiple fields', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
			};

			const filter = {
				_or: [{ name: 'Frodo' }, { name: 'Gandalf' }, { race: 'Hobbit' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('union all');
			expect(result.bindings).toBeDefined();
		});

		it('should handle complex AND/OR combinations', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				age: {},
			};

			const filter = {
				_or: [
					{
						_and: [{ race: 'Hobbit' }, { age: { _lt: 50 } }],
					},
					{
						_and: [{ race: 'Elf' }, { age: { _gt: 100 } }],
					},
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('union all');
			expect(result.bindings).toBeDefined();
		});

		it('should handle NOT conditions', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
			};

			const filter = {
				_not: [{ race: 'Orc' }, { name: 'Sauron' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should handle nested relationship filters', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
				},
			};

			const filter = {
				fellowship: {
					_or: [{ name: 'Fellowship of the Ring' }, { disbanded: false }],
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL.toLowerCase()).toContain('where');
		});
	});

	describe('Pagination and Ordering', () => {
		it('should handle simple ordering', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
			};

			const pagination = {
				orderBy: [{ name: 'asc' as any }, { age: 'desc' as any }],
				limit: 10,
				offset: 5,
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('offset');
			expect(result.bindings.limit).toBe(10);
			expect(result.bindings.offset).toBe(5);
		});

		it('should handle ordering with relationships', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
				},
			};

			const pagination = {
				orderBy: [{ name: 'asc' as any }],
				limit: 20,
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.bindings.limit).toBe(20);
		});

		it('should handle large offset pagination efficiently', () => {
			const fields = {
				id: {},
				name: {},
			};

			const pagination = {
				limit: 100,
				offset: 10000,
				orderBy: [{ id: 'asc' as any }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings.limit).toBe(100);
			expect(result.bindings.offset).toBe(10000);
		});
	});

	describe('Edge Cases and Error Scenarios', () => {
		it('should handle empty field selections gracefully', () => {
			const fields = {};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
		});

		it('should handle null and undefined filter values', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
			};

			const filter = {
				name: null,
				age: undefined,
				home: '',
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should handle circular relationship references', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
					members: {
						id: {},
						name: {},
						// This would create a circular reference in a real scenario
						// but should be handled gracefully
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.bindings).toBeDefined();
		});

		it('should handle very deep nesting levels', () => {
			const fields = {
				id: {},
				fellowship: {
					quest: {
						locations: {
							region: {
								locations: {
									battles: {
										id: {},
										name: {},
									},
								},
							},
						},
					},
				},
			};

			// Should not throw even with deep nesting
			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('Performance Scenarios', () => {
		it('should generate efficient queries for wide field selections', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
				race: {},
				home: {},
				ring: { id: {}, name: {}, power: {}, forgedBy: {} },
				fellowship: { id: {}, name: {}, purpose: {}, disbanded: {} },
				battles: {
					id: {},
					name: {},
					date: {},
					outcome: {},
					casualties: {},
					location: {
						id: {},
						name: {},
						type: {},
						region: { id: {}, name: {}, ruler: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toBeDefined();
			expect(result.querySQL.length).toBeGreaterThan(500); // Should be substantial
			expect(result.querySQL.length).toBeLessThan(20000); // But not excessively long
			expect(result.bindings).toBeDefined();
		});

		it('should handle multiple concurrent filter conditions efficiently', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
			};

			const filter = {
				_and: [
					{ race: { _in: ['Hobbit', 'Elf', 'Dwarf', 'Human'] } },
					{ age: { _between: [18, 500] } },
					{ name: { _like: '%o%' } },
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});
	});
});
