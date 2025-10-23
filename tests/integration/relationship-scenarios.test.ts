/**
 * Integration Tests for GQLtoSQLMapper - Relationship Scenarios
 *
 * These tests verify that the GQLtoSQLMapper correctly handles all types
 * of relationships and complex query scenarios using Middle-earth entities.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { GQLQueryManager } from '../../src/query-manager';
import {
	FieldSelection,
	GQLArgumentsFilterAndPagination,
	GQLEntityFilterInputFieldType,
} from '../../src/types';
import {
	Author,
	Battle,
	Book,
	Fellowship,
	Location,
	Person,
	Region,
	Ring,
} from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('GQLtoSQLMapper - Relationship Integration Tests', () => {
	let mapper: GQLtoSQLMapper;
	let queryManager: GQLQueryManager;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider, { namedParameterPrefix: ':' });
		queryManager = new GQLQueryManager({ namedParameterPrefix: ':' });
	});

	describe('1:1 Relationships (Person <-> Ring)', () => {
		it('should handle Person to Ring relationship', () => {
			const fields: FieldSelection<Person> = {
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
			const fields: FieldSelection<Ring> = {
				id: {},
				name: {},
				power: {},
				bearer: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
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
			const fields: FieldSelection<Person> = {
				id: {},
				name: {},
				ring: {
					fieldsByTypeName: {
						Ring: {
							id: {},
							name: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				ring: {
					name_eq: 'The One Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('1:m Relationships (Fellowship -> Members, Region -> Locations)', () => {
		it('should handle Fellowship to Members (1:m) relationship', () => {
			const fields: FieldSelection<Fellowship> = {
				id: {},
				name: {},
				purpose: {},
				members: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
							age: {},
						},
					},
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
			const fields: FieldSelection<Region> = {
				id: {},
				name: {},
				ruler: {},
				locations: {
					fieldsByTypeName: {
						location: {
							id: {},
							name: {},
							type: {},
							description: {},
						},
					},
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
			const fields: FieldSelection<Fellowship> = {
				id: {},
				name: {},
				members: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Fellowship> = {
				members: {
					race_eq: 'Hobbit',
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
				filter,
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
			const fields: FieldSelection<Person> = {
				id: {},
				name: {},
				race: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: {
							id: {},
							name: {},
							purpose: {},
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
			expect(result.querySQL).toContain('fellowship_id');
			expect(result.bindings).toBeDefined();
		});

		it('should handle Book to Author (m:1) relationship', () => {
			const fields: FieldSelection<Book> = {
				id: {},
				title: {},
				publishedYear: {},
				author: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							birthYear: {},
							nationality: {},
						},
					},
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
			const fields: FieldSelection<Person> = {
				id: {},
				name: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: {
							id: {},
							name: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				fellowship: {
					name_eq: 'Fellowship of the Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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
					fieldsByTypeName: {
						Battle: {
							id: {},
							name: {},
							date: {},
							outcome: {},
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
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
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
					fieldsByTypeName: {
						Genre: {
							id: {},
							name: {},
							description: {},
						},
					},
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
					fieldsByTypeName: {
						Battle: {
							id: {},
							name: {},
							outcome: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				battles: {
					outcome_eq: 'Victory',
					casualties: { _lt: 1000 },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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
					fieldsByTypeName: {
						Fellowship: {
							id: {},
							name: {},
							quest: {
								fieldsByTypeName: {
									Quest: {
										id: {},
										name: {},
										description: {},
										locations: {
											fieldsByTypeName: {
												Location: {
													id: {},
													name: {},
													region: {
														fieldsByTypeName: {
															Region: {
																id: {},
																name: {},
																ruler: {},
															},
														},
													},
												},
											},
										},
									},
								},
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
					fieldsByTypeName: {
						Ring: {
							id: {},
							name: {},
							power: {},
						},
					},
				},
				// m:1 relationship
				fellowship: {
					fieldsByTypeName: {
						Fellowship: {
							id: {},
							name: {},
							purpose: {},
						},
					},
				},
				// m:m relationship
				battles: {
					fieldsByTypeName: {
						Battle: {
							id: {},
							name: {},
							outcome: {},
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
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('Relationship Field Filters', () => {
		it('should filter Person by Fellowship name', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: {
							id: {},
							name: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				fellowship: {
					name_eq: 'Fellowship of the Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('fellowship_name');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Fellowship by member race', () => {
			const fields = {
				id: {},
				name: {},
				purpose: {},
				members: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Fellowship> = {
				members: {
					race_eq: 'Hobbit',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('race');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Person by Ring name', () => {
			const fields = {
				id: {},
				name: {},
				ring: {
					fieldsByTypeName: {
						Ring: {
							id: {},
							name: {},
							power: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				ring: {
					name_eq: 'The One Ring',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('ring_name');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Region by location name', () => {
			const fields = {
				id: {},
				name: {},
				ruler: {},
				locations: {
					fieldsByTypeName: {
						location: {
							id: {},
							name: {},
							type: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Region> = {
				locations: {
					name_eq: 'Minas Tirith',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('regions');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('location_name');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Person by Battle outcome (m:m relationship)', () => {
			const fields = {
				id: {},
				name: {},
				race: {},
				battles: {
					fieldsByTypeName: {
						Battle: {
							id: {},
							name: {},
							outcome: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				battles: {
					outcome_eq: 'Victory',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('outcome');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Book by Author nationality', () => {
			const fields = {
				id: {},
				title: {},
				author: {
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							nationality: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Book> = {
				author: {
					nationality_eq: 'British',
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Book,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('authors');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('nationality');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Battle by location region name (nested relationship)', () => {
			const fields = {
				id: {},
				name: {},
				outcome: {},
				location: {
					fieldsByTypeName: {
						location: {
							id: {},
							name: {},
							region: {
								fieldsByTypeName: {
									Region: {
										id: {},
										name: {},
										ruler: {},
									},
								},
							},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Battle> = {
				location: {
					region: {
						name_eq: 'Gondor',
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Battle,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('regions');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('region_name');
			expect(result.bindings).toBeDefined();
		});

		it('should filter with operation modifiers in relationship fields', () => {
			const fields = {
				id: {},
				name: {},
				members: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							age: {},
						},
					},
				},
			};

			const filter = {
				members: {
					age: { _gt: 100 },
					name: { _like: 'Legolas%' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should filter with multiple relationship field conditions', () => {
			const fields = {
				id: {},
				name: {},
				ring: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
						},
					},
				},
				fellowship: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				ring: {
					name: { _ne: null },
				},
				fellowship: {
					disbanded_eq: false,
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should filter with OR conditions in relationship fields', () => {
			const fields = {
				id: {},
				name: {},
				battles: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							outcome: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				battles: {
					_or: [{ name_eq: "Battle of Helm's Deep" }, { outcome_eq: 'Victory' }],
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should filter with complex nested relationship conditions', () => {
			const fields = {
				id: {},
				name: {},
				fellowship: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							quest: {
								fieldsByTypeName: {
									EditMe: {
										id: {},
										name: {},
										success: {},
									},
								},
							},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				fellowship: {
					quest: {
						success_eq: true,
						name: { _like: '%Ring%' },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('quests');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL).toContain('success');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('Reference List Filtering and Pagination', () => {
		it('should filter Fellowship members by name pattern', () => {
			const fields: FieldSelection<Fellowship> = {
				id: {},
				name: {},
				purpose: {},
				members: {
					name: 'members',
					args: {
						filter: {
							name: { _like: 'Frodo%' },
						},
					} as GQLArgumentsFilterAndPagination<Person>,
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('person_name');
			expect(result.querySQL.toLowerCase()).toContain('where');
			// expect(result.querySQL).toContain('Frodo%');
			expect(result.bindings).toBeDefined();
			expect(result.bindings).toContainAnyValues(['Frodo%']);
		});

		it('should filter Region Locations by type', () => {
			const fields: FieldSelection<Region> = {
				id: {},
				name: {},
				ruler: {},
				locations: {
					args: {
						filter: {
							type: 'City',
						},
					} as GQLArgumentsFilterAndPagination<Location>,
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							type: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
			});

			expect(result.querySQL).toContain('regions');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('location_type');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Person battles by outcome with complex conditions', () => {
			const fields: FieldSelection<Person> = {
				id: {},
				name: {},
				race: {},
				battles: {
					args: {
						filter: {
							outcome: 'Victory',
							casualties: { _lt: 500 },
						},
					},
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							outcome: {},
							casualties: {},
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
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL).toContain('outcome');
			expect(result.querySQL).toContain('casualties');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it('should filter Author books by published year range', () => {
			const x: FieldSelection<Author>['books'] = {};
			const fields: FieldSelection<Author> = {
				id: {},
				name: {},
				nationality: {},
				books: {
					args: {
						filter: {
							publishedYear: { _between: [1930, 1960] },
						},
					},
					fieldsByTypeName: {
						EditMe: {
							id: {},
							title: {},
							publishedYear: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('authors');
			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('published_year');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});

		it.skip('should filter reference list with OR conditions', () => {
			const fields: FieldSelection<Fellowship> = {
				id: {},
				name: {},
				purpose: {},
				members: {
					args: {
						filter: {
							_or: [{ race: 'Hobbit' }, { age: { _gt: 500 } }],
						},
					},
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							race: {},
							age: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('race');
			expect(result.querySQL).toContain('age');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
			const values = Object.values(result.bindings);
			expect(values).toContain(500);
			expect(values).toContain('Hobbit');
		});

		it('should paginate Fellowship members to get only first member', () => {
			const fields: FieldSelection<Fellowship> = {
				id: {},
				name: {},
				purpose: {},
				members: {
					name: 'members',
					args: {
						pagination: {
							limit: 1,
							orderBy: [{ name: 'asc' as any }],
						},
					},
					fieldsByTypeName: {
						Person: {
							id: {},
							name: {},
							race: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Fellowship,
				customFields: {},
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.bindings).toBeDefined();
		});

		it('should paginate Region Locations with offset', () => {
			const fields: FieldSelection<Region> = {
				id: {},
				name: {},
				ruler: {},
				locations: {
					args: {
						pagination: {
							limit: 3,
							offset: 2,
							orderBy: [{ name: 'desc' as any }],
						},
					},
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							type: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
			});

			expect(result.querySQL).toContain('regions');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('offset');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.bindings).toBeDefined();
		});

		it('should paginate Person battles (m:m) with ordering by date', () => {
			const fields: FieldSelection<Person> = {
				id: {},
				name: {},
				race: {},
				battles: {
					args: {
						pagination: {
							limit: 2,
							orderBy: [{ date: 'desc' as any }],
						},
					},
					fieldsByTypeName: {
						Battle: {
							id: {},
							name: {},
							date: {},
							outcome: {},
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
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('person_battles');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.querySQL).toContain('battle_date');
			expect(result.bindings).toBeDefined();
		});

		it('should combine filtering and pagination on reference list', () => {
			const fields: FieldSelection<Author> = {
				id: {},
				name: {},
				nationality: {},
				books: {
					args: {
						filter: {
							pages: { _gt: 200 },
						},
						pagination: {
							limit: 1,
							orderBy: [{ publishedYear: 'desc' as any }],
						},
					},
					fieldsByTypeName: {
						EditMe: {
							id: {},
							title: {},
							publishedYear: {},
							pages: {},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Author,
				customFields: {},
			});

			expect(result.querySQL).toContain('authors');
			expect(result.querySQL).toContain('books');
			expect(result.querySQL).toContain('page_count');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('order by');
			expect(result.querySQL).toContain('published_year');
			expect(result.bindings).toBeDefined();
		});

		it('should handle nested relationship with reference list pagination', () => {
			const fields: FieldSelection<Region> = {
				id: {},
				name: {},
				locations: {
					args: {
						filter: {
							type: 'City',
						},
					},
					fieldsByTypeName: {
						Location: {
							id: {},
							name: {},
							battles: {
								args: {
									pagination: {
										limit: 1,
										orderBy: [{ name: 'asc' as any }],
									},
								},
								fieldsByTypeName: {
									Battle: {
										id: {},
										name: {},
										outcome: {},
									},
								},
							},
						},
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Region,
				customFields: {},
			});

			expect(result.querySQL).toContain('regions');
			expect(result.querySQL).toContain('locations');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('location_type');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.querySQL.toLowerCase()).toContain('limit');
			expect(result.querySQL.toLowerCase()).toContain('order by');
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

			const filter: GQLEntityFilterInputFieldType<Person> = {
				_or: [{ name_eq: 'Frodo' }, { name_eq: 'Gandalf' }, { race_eq: 'Hobbit' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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

			const filter: GQLEntityFilterInputFieldType<Person> = {
				_or: [
					{
						_and: [{ race_eq: 'Hobbit' }, { age: { _lt: 50 } }],
					},
					{
						_and: [{ race_eq: 'Elf' }, { age: { _gt: 100 } }],
					},
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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

			const filter: GQLEntityFilterInputFieldType<Person> = {
				_not: [{ race_eq: 'Orc' }, { name_eq: 'Sauron' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
						},
					},
				},
			};

			const filter: GQLEntityFilterInputFieldType<Person> = {
				fellowship: {
					_or: [{ name_eq: 'Fellowship of the Ring' }, { disbanded_eq: false }],
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
						},
					},
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

			const filter: GQLEntityFilterInputFieldType<Person> = {
				name_eq: null,
				age: undefined,
				home_eq: '',
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter,
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
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							members: {
								fieldsByTypeName: {
									EditMe: {
										id: {},
										name: {},
										// This would create a circular reference in a real scenario
										// but should be handled gracefully
									},
								},
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
			expect(result.bindings).toBeDefined();
		});

		it('should handle very deep nesting levels', () => {
			const fields = {
				id: {},
				fellowship: {
					fieldsByTypeName: {
						EditMe: {
							quest: {
								fieldsByTypeName: {
									EditMe: {
										locations: {
											fieldsByTypeName: {
												EditMe: {
													region: {
														fieldsByTypeName: {
															EditMe: {
																locations: {
																	fieldsByTypeName: {
																		EditMe: {
																			battles: {
																				fieldsByTypeName: {
																					EditMe: {
																						id: {},
																						name: {},
																					},
																				},
																			},
																		},
																	},
																},
															},
														},
													},
												},
											},
										},
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
				ring: {
					fieldsByTypeName: {
						EditMe: { id: {}, name: {}, power: {}, forgedBy: {} },
					},
				},
				fellowship: {
					fieldsByTypeName: {
						EditMe: { id: {}, name: {}, purpose: {}, disbanded: {} },
					},
				},
				battles: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							date: {},
							outcome: {},
							casualties: {},
							location: {
								fieldsByTypeName: {
									EditMe: {
										id: {},
										name: {},
										type: {},
										region: {
											fieldsByTypeName: {
												EditMe: { id: {}, name: {}, ruler: {} },
											},
										},
									},
								},
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
				filter,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL.toLowerCase()).toContain('where');
			expect(result.bindings).toBeDefined();
		});
	});
});
