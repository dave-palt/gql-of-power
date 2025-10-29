/**
 * Unit Tests for GQLtoSQLMapper
 *
 * These tests focus on individual methods of the GQLtoSQLMapper class
 * to ensure each component works correctly in isolation before refactoring.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { EntityMetadata } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { SQLBuilder } from '../../src/queries/sql-builder';
import { QueriesUtils } from '../../src/queries/utils';
import { Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('GQLtoSQLMapper - Unit Tests', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
	});

	describe('Utility Functions', () => {
		describe('newMappings', () => {
			it('should create a new mapping object with correct initial state', () => {
				const mapping = QueriesUtils.newMappings();

				expect(mapping.select).toBeInstanceOf(Set);
				expect(mapping.select.size).toBe(0);
				expect(mapping.json).toEqual([]);
				expect(mapping.innerJoin).toEqual([]);
				expect(mapping.outerJoin).toEqual([]);
				expect(mapping.where).toEqual([]);
				expect(mapping.values).toEqual({});
				expect(mapping.orderBy).toEqual([]);
				expect(mapping._or).toEqual([]);
				expect(mapping._and).toEqual([]);
				expect(mapping._not).toEqual([]);
			});
		});

		describe('generateJsonSelectStatement', () => {
			it('should generate correct JSONB object for single record', () => {
				const result = SQLBuilder.generateJsonSelectStatement('alias', false);

				expect(result).toBe('row_to_json(alias)::jsonb');
			});

			it('should generate correct JSONB array for multiple records', () => {
				const result = SQLBuilder.generateJsonSelectStatement('alias', true);

				expect(result).toBe("coalesce(json_agg(row_to_json(alias))::json, '[]'::json)::jsonb");
			});
		});

		describe('mappingsReducer', () => {
			it('should merge multiple mappings correctly', () => {
				const mapping1 = QueriesUtils.newMappings();
				mapping1.select.add('field1');
				mapping1.json.push("'key1', field1");
				mapping1.where.push("field1 = 'value1'");
				mapping1.values = { param1: 'value1' };

				const mapping2 = QueriesUtils.newMappings();
				mapping2.select.add('field2');
				mapping2.json.push("'key2', field2");
				mapping2.where.push("field2 = 'value2'");
				mapping2.values = { param2: 'value2' };

				const mappingsMap = new Map([
					['map1', mapping1],
					['map2', mapping2],
				]);

				const result = QueriesUtils.mappingsReducer(mappingsMap);

				expect(result.select.has('field1')).toBe(true);
				expect(result.select.has('field2')).toBe(true);
				expect(result.json).toContain("'key1', field1");
				expect(result.json).toContain("'key2', field2");
				expect(result.where).toContain("field1 = 'value1'");
				expect(result.where).toContain("field2 = 'value2'");
				expect(result.values).toEqual({ param1: 'value1', param2: 'value2' });
			});

			it('should handle empty mappings', () => {
				const result = QueriesUtils.mappingsReducer(new Map());

				expect(result.select.size).toBe(0);
				expect(result.json).toEqual([]);
				expect(result.where).toEqual([]);
				expect(result.values).toEqual({});
			});

			it('should preserve limit, offset, and orderBy from mappings', () => {
				const mapping = QueriesUtils.newMappings();
				mapping.limit = 10;
				mapping.offset = 5;
				mapping.orderBy = [{ name: 'asc' as any }];

				const mappingsMap = new Map([['test', mapping]]);
				const result = QueriesUtils.mappingsReducer(mappingsMap);

				expect(result.limit).toBe(10);
				expect(result.offset).toBe(5);
				expect(result.orderBy).toEqual([{ name: 'asc' }]);
			});
		});
	});

	describe('buildQueryAndBindingsFor', () => {
		it('should build a basic query for simple entity with no relationships', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.querySQL).toContain('id');
			expect(result.querySQL).toContain('person_name AS "name"');
			expect(result.querySQL).toContain('age');
			expect(result.bindings).toBeDefined();
			expect(typeof result.bindings.limit).toBe('number');
		});

		it('should handle empty fields gracefully', () => {
			const fields = {};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
		});

		it('should apply filters correctly', () => {
			const fields = {
				id: {},
				name: {},
			};

			const filter = {
				name: 'Frodo Baggins',
				age: { _gt: 30 },
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
			// The filter should generate some WHERE conditions
			expect(result.querySQL.toLowerCase()).toContain('where');
		});

		it('should apply pagination correctly', () => {
			const fields = {
				id: {},
				name: {},
			};

			const pagination = {
				limit: 5,
				offset: 10,
				orderBy: [{ name: 'asc' as any }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings.limit).toBe(5);
			expect(result.bindings.offset).toBe(10);
			expect(result.querySQL.toLowerCase()).toContain('order by');
		});

		it('should handle unknown entity gracefully', () => {
			class UnknownEntity {
				id!: number;
				name!: string;
			}

			const fields = { id: {}, name: {} };

			expect(() => {
				mapper.buildQueryAndBindingsFor({
					fields,
					entity: UnknownEntity,
					customFields: {},
				});
			}).toThrow('Entity metadata not found for: UnknownEntity');
		});
	});

	describe('recursiveMap', () => {
		it('should map simple fields correctly', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
			};

			const personMetadata = mockProvider.getMetadata<Person, EntityMetadata<Person>>('Person');
			const alias = {
				toString: () => 'a1',
				toColumnName: (col: string) => `a1.${col}`,
				toParamName: (col: string) => `a1_${col}`,
				concat: (str: string) => `a1_${str}`,
			} as any;

			const result = mapper.recursiveMap({
				entityMetadata: personMetadata,
				fields,
				parentAlias: alias,
				alias,
				gqlFilters: [],
				customFields: {},
			});

			expect(result).toBeInstanceOf(Map);
			expect(result.size).toBeGreaterThan(0);

			// Check that basic field mappings were created
			const mappingEntries = Array.from(result.entries());
			expect(mappingEntries.length).toBeGreaterThan(0);
		});

		it('should handle filters in recursiveMap', () => {
			const fields = {
				id: {},
				name: {},
			};

			const filters = [
				{
					name: 'Frodo',
					age: { _gt: 30 },
				},
			];

			const personMetadata = mockProvider.getMetadata<Person, EntityMetadata<Person>>('Person');
			const alias = {
				toString: () => 'a1',
				toColumnName: (col: string) => `a1.${col}`,
				toParamName: (col: string) => `a1_${col}`,
				concat: (str: string) => `a1_${str}`,
			} as any;

			const result = mapper.recursiveMap({
				entityMetadata: personMetadata,
				fields,
				parentAlias: alias,
				alias,
				gqlFilters: filters as any,
				customFields: {},
			});

			expect(result).toBeInstanceOf(Map);
			// Filters should generate additional mappings
			expect(result.size).toBeGreaterThan(0);
		});

		it('should handle custom fields', () => {
			const fields = {
				id: {},
				name: {},
				customField: {},
			};

			const customFields = {
				customField: {
					type: () => String,
					requires: ['name'],
					resolve: (parent: any) => parent.name.toUpperCase(),
				},
			};

			const personMetadata = mockProvider.getMetadata<Person, EntityMetadata<Person>>('Person');
			const alias = {
				toString: () => 'a1',
				toColumnName: (col: string) => `a1.${col}`,
				toParamName: (col: string) => `a1_${col}`,
				concat: (str: string) => `a1_${str}`,
			} as any;

			const result = mapper.recursiveMap({
				entityMetadata: personMetadata,
				fields,
				parentAlias: alias,
				alias,
				gqlFilters: [],
				customFields: customFields as any,
			});

			expect(result).toBeInstanceOf(Map);
			expect(result.size).toBeGreaterThan(0);
		});
	});

	describe('Integration with Sample Data', () => {
		it('should work with Fellowship entity and relationships', () => {
			const fields = {
				id: {},
				name: {},
				purpose: {},
				members: {
					fieldsByTypeName: {
						EditMe: {
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
			expect(result.querySQL).toContain('row_to_json');
			expect(result.querySQL).toContain('fellowship_name AS "name"');
			expect(result.bindings).toBeDefined();
		});

		it('should work with Ring entity and 1:1 relationship', () => {
			const fields = {
				id: {},
				name: {},
				power: {},
				bearer: {
					fieldsByTypeName: {
						EditMe: {
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
			expect(result.querySQL).toContain('row_to_json');
			expect(result.querySQL).toContain('ring_name AS "name"');
			expect(result.querySQL).toContain('power_description AS "power"');
			expect(result.bindings).toBeDefined();
		});

		it('should handle complex filtering scenarios', () => {
			const fields = {
				id: {},
				name: {},
			};

			const complexFilter = {
				_or: [
					{ name: 'Frodo' },
					{
						_and: [{ race: 'Hobbit' }, { age: { _lt: 40 } }],
					},
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				filter: complexFilter as any,
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
			// Complex filters should generate UNION ALL queries
			expect(
				result.querySQL.toLowerCase().includes('union') ||
					result.querySQL.toLowerCase().includes('where')
			).toBe(true);
		});
	});

	describe('Error Handling', () => {
		it('should throw meaningful error for missing entity metadata', () => {
			class NonExistentEntity {
				id!: number;
			}

			expect(() => {
				mapper.buildQueryAndBindingsFor({
					fields: { id: {} },
					entity: NonExistentEntity,
					customFields: {},
				});
			}).toThrow('Entity metadata not found');
		});

		it('should handle malformed field definitions gracefully', () => {
			const fields = {
				id: {},
				invalidField: null,
				undefinedField: undefined,
			};

			// Should not throw, but handle gracefully
			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
			});

			expect(result.querySQL).toContain('persons');
			expect(result.bindings).toBeDefined();
		});
	});

	describe('Performance and Optimization', () => {
		it('should generate efficient queries for large field sets', () => {
			const fields = {
				id: {},
				name: {},
				age: {},
				race: {},
				home: {},
				fellowship: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							purpose: {},
						},
					},
				},
				ring: {
					fieldsByTypeName: {
						EditMe: {
							id: {},
							name: {},
							power: {},
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
			expect(result.bindings).toBeDefined();

			// Check that the query is reasonably structured
			expect(result.querySQL.length).toBeGreaterThan(100);
			expect(result.querySQL.length).toBeLessThan(10000); // Should not be excessively long
		});

		it('should handle pagination efficiently', () => {
			const fields = { id: {}, name: {} };
			const pagination = { limit: 1000, offset: 50000 };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination,
			});

			expect(result.bindings.limit).toBe(1000);
			expect(result.bindings.offset).toBe(50000);
			expect(result.querySQL).toContain('limit');
			expect(result.querySQL).toContain('offset');
		});
	});
});
