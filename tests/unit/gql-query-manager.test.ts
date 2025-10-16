/**
 * Unit Tests for GQLQueryManager
 *
 * This test suite covers the GQLQueryManager class which serves as the high-level
 * interface for transforming GraphQL queries into SQL and executing them.
 * Tests focus on Middle-earth lore as per project guidelines.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GraphQLResolveInfo } from 'graphql';
import { GQLEntityFilterInputFieldType } from '../../src';
import { GQLQueryManager } from '../../src/query-manager';
import { Fellowship, Person, Quest, Ring } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('GQLQueryManager - Unit Tests', () => {
	let queryManager: GQLQueryManager;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		queryManager = new GQLQueryManager();
		mockProvider = createMockMetadataProvider();
	});

	/**
	 * Helper function to create a mock GraphQL ResolveInfo object
	 */
	const createMockInfo = (fieldSelection: any = {}): GraphQLResolveInfo => {
		return {
			fieldName: 'testQuery',
			fieldNodes: [
				{
					kind: 'Field',
					name: { kind: 'Name', value: 'testQuery' },
					selectionSet: {
						kind: 'SelectionSet',
						selections: Object.keys(fieldSelection).map((key) => ({
							kind: 'Field',
							name: { kind: 'Name', value: key },
							selectionSet:
								fieldSelection[key] && Object.keys(fieldSelection[key]).length > 0
									? {
											kind: 'SelectionSet',
											selections: Object.keys(fieldSelection[key]).map((subKey) => ({
												kind: 'Field',
												name: { kind: 'Name', value: subKey },
											})),
									  }
									: undefined,
						})),
					},
				},
			],
			returnType: {} as any,
			parentType: {} as any,
			path: { key: 'testQuery', prev: undefined, typename: undefined },
			schema: {} as any,
			fragments: {},
			rootValue: {},
			operation: {} as any,
			variableValues: {},
		} as GraphQLResolveInfo;
	};

	describe('getQueryResultsFor - Basic Functionality', () => {
		it('should execute a simple query for Person entity with basic fields', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				age: {},
			});
			type GQLPerson = Person & { _____name: 'Person' };
			const result = await queryManager.getQueryResultsFor<GQLPerson, Person>(
				mockProvider,
				Person,
				info
			);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);

			// Result should contain Frodo's data
			const frodo = result.find((person) => person.name === 'Frodo Baggins');
			expect(frodo).toBeDefined();
			expect(frodo!.age).toBe(50);
			expect(frodo!.race).toBe('Hobbit');
		});

		it('should execute a simple query for Ring entity with basic fields', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				power: {},
				forgedBy: {},
			});
			type GQLRing = Ring & { _____name: 'Ring' };
			const result = await queryManager.getQueryResultsFor<GQLRing, Ring>(mockProvider, Ring, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);

			// Result should contain the One Ring
			const oneRing = result.find((ring) => ring.name === 'The One Ring');

			expect(oneRing).toBeDefined();
			expect(oneRing!.power).toBe('Controls all other Rings of Power');
		});

		it('should execute a simple query for Fellowship entity', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				purpose: {},
				disbanded: {},
			});
			type GQLFellowship = Fellowship & { _____name: 'Fellowship' };
			const result = await queryManager.getQueryResultsFor<GQLFellowship, Fellowship>(
				mockProvider,
				Fellowship,
				info
			);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);

			// Result should contain Fellowship of the Ring
			const fellowship = result.find((f) => f.name === 'Fellowship of the Ring');
			expect(fellowship).toBeDefined();
			expect(fellowship!.purpose).toBe('Destroy the One Ring');
		});

		it('should handle empty field selection gracefully', async () => {
			const info = createMockInfo({});

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			// Even with no fields, should still return results
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe('getQueryResultsFor - Filtering', () => {
		it('should apply simple field filters', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
			});

			const filter: GQLEntityFilterInputFieldType<Person> = {
				race_eq: 'Hobbit',
			};

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info, filter);

			console.log(result);
			expect(Array.isArray(result)).toBe(true);
			// Filter should be processed (actual filtering happens in SQL execution)
			expect(result.length).toBeGreaterThan(0);
		});

		it('should apply comparison filters', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				age: {},
			});

			const filter = {
				age: { _gt: 100 },
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply complex nested filters with _or conditions', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				age: {},
			});

			const filter = {
				_or: [
					{ race: 'Hobbit' },
					{ race: 'Wizard' },
					{ _and: [{ race: 'Human' }, { age: { _gt: 80 } }] },
				],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply _and conditions', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				age: {},
			});

			const filter = {
				_and: [{ race: 'Hobbit' }, { age: { _lt: 40 } }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply _not conditions', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
			});

			const filter = {
				_not: [{ race: 'Orc' }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle multiple field operations', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				age: {},
			});

			const filter = {
				name: { _like: '%Baggins%' },
				age: { _gte: 30, _lte: 60 },
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe('getQueryResultsFor - Pagination', () => {
		it('should apply limit pagination', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
			});

			const pagination = {
				limit: 3,
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply offset pagination', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
			});

			const pagination = {
				limit: 5,
				offset: 2,
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply orderBy with single field ascending', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				age: {},
			});

			const pagination = {
				orderBy: [{ name: 'asc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply orderBy with single field descending', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				age: {},
			});

			const pagination = {
				orderBy: [{ age: 'desc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply orderBy with multiple fields', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				age: {},
			});

			const pagination = {
				orderBy: [{ race: 'asc' as const }, { age: 'desc' as const }, { name: 'asc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should apply complete pagination with filter', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				age: {},
			});

			const filter = {
				race: { _in: ['Hobbit', 'Human', 'Elf'] },
			};

			const pagination = {
				limit: 10,
				offset: 5,
				orderBy: [{ name: 'asc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe('getQueryResultsFor - Relationships', () => {
		it('should handle 1:1 relationship (Ring -> Bearer)', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				power: {},
				bearer: {
					id: {},
					name: {},
					race: {},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Ring, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle 1:m relationship (Fellowship -> Members)', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				purpose: {},
				members: {
					id: {},
					name: {},
					race: {},
					age: {},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Fellowship, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle m:1 relationship (Person -> Fellowship)', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				fellowship: {
					id: {},
					name: {},
					purpose: {},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle nested relationships (Fellowship -> Quest -> Locations)', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				purpose: {},
				quest: {
					id: {},
					name: {},
					description: {},
					locations: {
						id: {},
						name: {},
						type: {},
					},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Fellowship, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle deep nested relationships with multiple levels', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				fellowship: {
					id: {},
					name: {},
					quest: {
						id: {},
						name: {},
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
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle relationship filtering', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				fellowship: {
					id: {},
					name: {},
				},
			});

			const filter = {
				fellowship: {
					name: 'Fellowship of the Ring',
				},
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle complex relationship filtering with nested conditions', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				race: {},
				fellowship: {
					id: {},
					name: {},
					quest: {
						id: {},
						name: {},
					},
				},
			});

			const filter = {
				_and: [
					{ race: 'Hobbit' },
					{
						fellowship: {
							quest: {
								name: 'Destroy the One Ring',
							},
						},
					},
				],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe('getQueryResultsFor - Error Handling', () => {
		it('should throw error for incompatible entity', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Pass null entity
			await expect(
				queryManager.getQueryResultsFor(mockProvider, null as any, info)
			).rejects.toThrow('Entity not provided');
		});

		it('should throw error for entity without name', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Create entity without name property
			class EntityWithoutName {}

			await expect(
				queryManager.getQueryResultsFor(mockProvider, EntityWithoutName as any, info)
			).rejects.toThrow('Entity EntityWithoutName not found in metadata');
		});

		it('should throw error when entity not found in metadata', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			class UnknownEntity {
				static entityName = 'UnknownEntity';
			}

			await expect(
				queryManager.getQueryResultsFor(mockProvider, UnknownEntity as any, info)
			).rejects.toThrow('Entity UnknownEntity not found in metadata');
		});

		it('should handle malformed GraphQL info gracefully', async () => {
			const malformedInfo = {
				fieldName: 'test',
				fieldNodes: null,
			} as any;

			// Should not throw but may return empty results
			await expect(
				queryManager.getQueryResultsFor(mockProvider, Person, malformedInfo)
			).rejects.toThrow('Error parsing GraphQL fields from info');
		});

		it('should handle database execution errors gracefully', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Create a provider that throws on executeQuery
			const errorProvider = {
				...mockProvider,
				executeQuery: async () => {
					throw new Error('Database connection failed');
				},
			};

			await expect(queryManager.getQueryResultsFor(errorProvider, Person, info)).rejects.toThrow(
				'Database connection failed'
			);
		});
	});

	describe('getQueryResultsFor - Data Transformation', () => {
		it('should handle JSON string results correctly', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Mock provider that returns JSON string
			const jsonProvider = {
				...mockProvider,
				executeQuery: async () => [
					{ val: '{"id":1,"person_name":"Frodo","age":50}' },
					{ val: '{"id":2,"person_name":"Gandalf","age":null}' },
				],
			};

			const result = await queryManager.getQueryResultsFor(jsonProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(2);
			expect(result[0]).toEqual({ id: 1, person_name: 'Frodo', age: 50 } as any);
			expect(result[1]).toEqual({ id: 2, person_name: 'Gandalf', age: null } as any);
		});

		it('should handle object results correctly', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Mock provider that returns objects directly
			const objectProvider = {
				...mockProvider,
				executeQuery: async () => [
					{ val: { id: 1, person_name: 'Aragorn', age: 87 } },
					{ val: { id: 2, person_name: 'Legolas', age: 500 } },
				],
			};

			const result = await queryManager.getQueryResultsFor(objectProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(2);
			expect(result[0]).toEqual({ id: 1, person_name: 'Aragorn', age: 87 } as any);
			expect(result[1]).toEqual({ id: 2, person_name: 'Legolas', age: 500 } as any);
		});

		it('should handle mixed data types in results', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			// Mixed JSON strings and objects
			const mixedProvider = {
				...mockProvider,
				executeQuery: async () => [
					{ val: '{"id":1,"person_name":"Gimli"}' },
					{ val: { id: 2, person_name: 'Boromir' } },
				],
			};

			const result = await queryManager.getQueryResultsFor(mixedProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(2);
			expect(result[0]).toEqual({ id: 1, person_name: 'Gimli' } as any);
			expect(result[1]).toEqual({ id: 2, person_name: 'Boromir' } as any);
		});

		it('should handle empty results', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			const emptyProvider = {
				...mockProvider,
				executeQuery: async () => [],
			};

			const result = await queryManager.getQueryResultsFor(emptyProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});

		it('should handle null results', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			const nullProvider = {
				...mockProvider,
				executeQuery: async () => [{ val: null }],
			};

			const result = await queryManager.getQueryResultsFor(nullProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(1);
			expect(result[0]).toBeNull();
		});
	});

	describe('getQueryResultsFor - Performance and Edge Cases', () => {
		it('should handle large field selections efficiently', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				age: {},
				race: {},
				home: {},
				fellowship: {
					id: {},
					name: {},
					purpose: {},
					disbanded: {},
					formed: {},
					quest: {
						id: {},
						name: {},
						description: {},
						startDate: {},
						endDate: {},
						success: {},
					},
				},
				ring: {
					id: {},
					name: {},
					power: {},
					forgedBy: {},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle complex pagination with large offsets', async () => {
			const info = createMockInfo({ id: {}, name: {} });

			const pagination = {
				limit: 100,
				offset: 10000,
				orderBy: [{ name: 'asc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				undefined,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle very complex filters', async () => {
			const info = createMockInfo({ id: {}, name: {}, race: {}, age: {} });

			const complexFilter = {
				_or: [
					{
						_and: [{ race: 'Hobbit' }, { age: { _lt: 50 } }, { name: { _like: '%Baggins%' } }],
					},
					{
						_and: [
							{ race: 'Human' },
							{ age: { _gte: 80 } },
							{ _not: [{ name: { _like: '%Boromir%' } }] },
						],
					},
					{
						_and: [{ race: { _in: ['Elf', 'Dwarf'] } }, { age: { _gt: 100 } }],
					},
				],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Person,
				info,
				complexFilter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle recursive relationship structures', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				fellowship: {
					id: {},
					name: {},
					members: {
						id: {},
						name: {},
						fellowship: {
							id: {},
							name: {},
						},
					},
				},
			});

			const result = await queryManager.getQueryResultsFor(mockProvider, Person, info);

			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe('getQueryResultsFor - Integration Scenarios', () => {
		it('should handle a complete Fellowship query with all relationships', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				purpose: {},
				disbanded: {},
				formed: {},
				members: {
					id: {},
					name: {},
					race: {},
					age: {},
					home: {},
					ring: {
						id: {},
						name: {},
						power: {},
					},
				},
				quest: {
					id: {},
					name: {},
					description: {},
					startDate: {},
					endDate: {},
					success: {},
					locations: {
						id: {},
						name: {},
						type: {},
						description: {},
						region: {
							id: {},
							name: {},
							ruler: {},
						},
					},
				},
			});

			const filter = {
				name: 'Fellowship of the Ring',
			};

			const pagination = {
				limit: 1,
				orderBy: [{ name: 'asc' as const }],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Fellowship,
				info,
				filter as any,
				pagination
			);

			expect(Array.isArray(result)).toBe(true);
		});

		it('should handle Quest search with location and fellowship filters', async () => {
			const info = createMockInfo({
				id: {},
				name: {},
				description: {},
				startDate: {},
				endDate: {},
				success: {},
				fellowship: {
					id: {},
					name: {},
					disbanded: {},
				},
				locations: {
					id: {},
					name: {},
					type: {},
				},
			});

			const filter = {
				_and: [
					{ success: true },
					{
						fellowship: {
							name: { _like: '%Fellowship%' },
						},
					},
					{
						locations: {
							name: { _in: ['Mount Doom', 'Minas Tirith'] },
						},
					},
				],
			};

			const result = await queryManager.getQueryResultsFor(
				mockProvider,
				Quest,
				info,
				filter as any
			);

			expect(Array.isArray(result)).toBe(true);
		});
	});
});
