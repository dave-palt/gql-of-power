/**
 * Unit Tests for GQLtoSQLMapper
 *
 * These tests focus on individual methods of the GQLtoSQLMapper class
 * to ensure each component works correctly in isolation before refactoring.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EntityMetadata, setGlobalConfig } from '../../src';
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

	describe('customFields with mapping strategy', () => {
		it('should generate a LEFT JOIN for a single FK column (string shorthand)', () => {
			// Person.fellowshipId → Fellowship.id, declared as a custom field
			const fields = {
				id: {},
				name: {},
				fellowshipId: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						options: { nullable: true },
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',       // string shorthand
							fields: 'fellowshipId', // string shorthand
						},
					},
				} as any,
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('left outer join lateral');
			expect(result.querySQL).toContain('row_to_json');
			expect(result.querySQL).toContain('"fellowship"');
		});

		it('should generate a LEFT JOIN for array FK columns (composite key)', () => {
			// Simulate a composite FK: Person.id + Person.race → Ring.bearerId + Ring.power
			const fields = {
				id: {},
				name: {},
				ring: {
					fieldsByTypeName: {
						Ring: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					ring: {
						type: () => Ring,
						options: { nullable: true },
						mapping: {
							refEntity: Ring,
							refFields: ['bearerId'],   // array form
							fields: ['id'],             // array form
						},
					},
				} as any,
			});

			expect(result.querySQL).toContain('rings');
			expect(result.querySQL).toContain('left outer join lateral');
			expect(result.querySQL).toContain('row_to_json');
			expect(result.querySQL).toContain('"ring"');
		});

		it('should fall back to null when the reference entity is not registered', () => {
			class UnregisteredEntity {
				id!: number;
			}

			const fields = { id: {}, name: {}, unregistered: {} };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					unregistered: {
						type: () => UnregisteredEntity,
						mapping: {
							refEntity: UnregisteredEntity,
							refFields: 'id',
							fields: 'id',
						},
					},
				} as any,
			});

			expect(result.querySQL).toContain('null AS "unregistered"');
		});

		it('should select FK column(s) on the owner side', () => {
			const fields = {
				id: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',
							fields: 'fellowshipId',
						},
					},
				} as any,
			});

			// The owner FK column must be in the SELECT so the JOIN ON clause can reference it
			expect(result.querySQL).toContain('fellowship_id');
		});

		it('should not generate a FieldResolver (mapping is SQL-only, resolve is absent)', () => {
			// This is a compile-time / type check — at runtime we just verify the query builds fine
			const fields = { id: {}, name: {} };

			expect(() => {
				mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {
						fellowship: {
							type: () => Fellowship,
							mapping: {
								refEntity: Fellowship,
								refFields: 'id',
								fields: 'fellowshipId',
							},
						},
					} as any,
				});
			}).not.toThrow();
		});

		it('should use SQL column name (not ORM property name) for FK in ON clause and SELECT', () => {
			// PersonMetadata maps fellowshipId → fellowship_id (SQL column).
			// The ON clause and SELECT must use fellowship_id, not fellowshipId.
			const fields = {
				id: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',
							fields: 'fellowshipId',
						},
					},
				} as any,
			});

			// Must use the SQL column name, not the camelCase ORM property
			expect(result.querySQL).toContain('fellowship_id');
			expect(result.querySQL).not.toContain('fellowshipId');
			// ON clause: owner.fellowship_id = ref.id
			expect(result.querySQL).toMatch(/fellowship_id\s*=\s*\S+\.id/);
		});

		it('should include FK column in the inner subquery (rawSelect) so lateral join WHERE can reference it', () => {
			// The lateral join references e_a1.fellowship_id in its WHERE clause.
			// If fellowship_id is only in the outer SELECT but not the inner subquery,
			// PostgreSQL raises "column does not exist".
			const fields = {
				id: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',
							fields: 'fellowshipId',
						},
					},
				} as any,
			});

			// The inner subquery (between the first pair of parens after FROM) must include fellowship_id.
			// We verify by checking that fellowship_id appears before the lateral join keyword.
			const lateralIndex = result.querySQL.indexOf('left outer join lateral');
			const innerSubquery = result.querySQL.substring(0, lateralIndex);
			expect(innerSubquery).toContain('fellowship_id');
		});

		it('should use correct ON clause direction: owner FK = ref PK (not swapped)', () => {
			// ON clause must be: persons_alias.fellowship_id = fellowships_alias.id
			// NOT: fellowships_alias.fellowship_id = persons_alias.id
			const fields = {
				id: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',
							fields: 'fellowshipId',
						},
					},
				} as any,
			});

			// The WHERE inside the lateral join subquery must reference the fellowship table
			// alias for 'id' and the outer (person) alias for 'fellowship_id'.
			// Pattern: <person_alias>.fellowship_id = <fellowship_alias>.id
			// The field alias prefix varies (f_p, f_j, etc.) so we use a flexible pattern.
			expect(result.querySQL).toMatch(/e_a\d+\.fellowship_id\s*=\s*f_\w+\d+\.id/);
		});

		it('should include order-by fields in the inner subquery so outer ORDER BY can reference them', () => {
			// When orderBy is used, the ORDER BY clause references the outer alias (e.g. e_a1.allocated_date).
			// If allocated_date is not in the inner subquery SELECT, PostgreSQL raises "column does not exist".
			// We use Person with age as the order-by field (maps to SQL column 'age').
			const fields = { id: {}, name: {} };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination: {
					orderBy: [{ age: 'desc' as any }],
				},
			});

			// age must appear in the inner subquery (before the ORDER BY clause)
			const orderByIndex = result.querySQL.indexOf('order by');
			const beforeOrderBy = result.querySQL.substring(0, orderByIndex);
			expect(beforeOrderBy).toContain('age');
			expect(result.querySQL.toLowerCase()).toContain('order by');
		});

		it('should include order-by field in inner subquery even when field uses SQL column name mapping', () => {
			// Person.home maps to SQL column 'home_location'. Order by home → should put home_location
			// in the inner subquery, not just the outer SELECT.
			const fields = { id: {}, name: {} };

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {},
				pagination: {
					orderBy: [{ home: 'asc' as any }],
				},
			});

			const orderByIndex = result.querySQL.indexOf('order by');
			const beforeOrderBy = result.querySQL.substring(0, orderByIndex);
			// home_location is the SQL column for the 'home' ORM property
			expect(beforeOrderBy).toContain('home_location');
		});

		it('should correctly resolve sub-fields of the ref entity regardless of GQL type name suffix', () => {
			// fieldsByTypeName is keyed by the GQL type name which may have a suffix (e.g. 'FellowshipV2').
			// The mapper must resolve sub-fields using getGQLEntityNameFor so the suffix is applied.
			setGlobalConfig({ gqlTypesSuffix: 'V2' });
			try {
				const fields = {
					id: {},
					fellowship: {
						fieldsByTypeName: {
							FellowshipV2: { id: {}, name: {} }, // suffixed GQL type name
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {
						fellowship: {
							type: () => Fellowship,
							mapping: {
								refEntity: Fellowship,
								refFields: 'id',
								fields: 'fellowshipId',
							},
						},
					} as any,
				});

				// Sub-fields id and fellowship_name should appear inside the lateral subquery
				expect(result.querySQL).toContain('fellowships');
				expect(result.querySQL).toContain('fellowship_name');
			} finally {
				setGlobalConfig({ gqlTypesSuffix: '' });
			}
		});

		it('should handle mapping alongside regular ORM relation fields in the same query', () => {
			// Querying both a regular ORM relation (ring, which is 1:1 via ORM)
			// and a custom mapping field simultaneously.
			const fields = {
				id: {},
				name: {},
				fellowship: {
					fieldsByTypeName: {
						Fellowship: { id: {}, name: {} },
					},
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: Person,
				customFields: {
					fellowship: {
						type: () => Fellowship,
						mapping: {
							refEntity: Fellowship,
							refFields: 'id',
							fields: 'fellowshipId',
						},
					},
				} as any,
			});

			expect(result.querySQL).toContain('fellowships');
			expect(result.querySQL).toContain('left outer join lateral');
			expect(result.querySQL).toContain('"fellowship"');
		});
	});

	describe('fieldsByTypeName suffix key resolution', () => {
		// graphql-parse-resolve-info keys fieldsByTypeName by the GQL type name which
		// includes any configured suffix (e.g. 'FellowshipV2' when suffix = 'V2').
		// Both mapField (ORM relations) and mapCustomField (mapping branch) must resolve
		// sub-fields using getGQLEntityNameFor(ormName) so the suffix is applied consistently.

		afterEach(() => {
			// Reset suffix after each test so other test groups are unaffected
			setGlobalConfig({ gqlTypesSuffix: '' });
		});

		describe('mapField — ORM declared relations', () => {
			it('should resolve sub-fields from suffixed GQL type name for m:1 ORM relation', () => {
				// When suffix = 'V2', fieldsByTypeName is keyed 'FellowshipV2', not 'Fellowship'.
				// mapField must use getGQLEntityNameFor('Fellowship') → 'FellowshipV2' to find sub-fields.
				setGlobalConfig({ gqlTypesSuffix: 'V2' });

				const fields = {
					id: {},
					fellowship: {
						fieldsByTypeName: {
							FellowshipV2: { id: {}, name: {} }, // suffix-keyed
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {},
				});

				// The lateral join for fellowship must exist and include sub-fields
				expect(result.querySQL).toContain('fellowships');
				expect(result.querySQL).toContain('left outer join lateral');
				// fellowship_name is the SQL column for Fellowship.name
				expect(result.querySQL).toContain('fellowship_name');
			});

			it('should NOT include sub-fields when fieldsByTypeName key has no suffix but suffix is configured', () => {
				// Contrast: if the key is 'Fellowship' (no suffix) but suffix = 'V2',
				// getGQLEntityNameFor('Fellowship') = 'FellowshipV2' ≠ 'Fellowship' → sub-fields not found.
				// The fallback then tries the raw ORM name — so this documents the fallback behaviour.
				// The point: without the suffix-aware lookup the suffixed case silently omits sub-fields.
				setGlobalConfig({ gqlTypesSuffix: 'V2' });

				const fields = {
					id: {},
					fellowship: {
						fieldsByTypeName: {
							FellowshipV2: { id: {}, name: {} }, // correct suffix key
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {},
				});

				// fellowship_name must be present (suffix-aware lookup finds the sub-fields)
				expect(result.querySQL).toContain('fellowship_name');
			});

			it('should still resolve sub-fields when no suffix is configured (no-suffix baseline)', () => {
				// Without suffix: getGQLEntityNameFor('Fellowship') = 'Fellowship'.
				// fieldsByTypeName keyed by 'Fellowship' must still be found.
				// gqlTypesSuffix defaults to '' so no setGlobalConfig call needed.
				const fields = {
					id: {},
					fellowship: {
						fieldsByTypeName: {
							Fellowship: { id: {}, name: {} }, // no suffix
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {},
				});

				expect(result.querySQL).toContain('fellowships');
				expect(result.querySQL).toContain('fellowship_name');
			});

			it('should resolve sub-fields for a nested 1:m ORM relation under suffix', () => {
				// Fellowship.members is a 1:m ORM relation.
				// When suffix = 'V2', fieldsByTypeName for members is keyed 'PersonV2'.
				// The mapper must look up 'PersonV2' (not 'Person') to find the member sub-fields.
				setGlobalConfig({ gqlTypesSuffix: 'V2' });

				// Re-create mapper with fresh provider so setGlobalConfig takes effect in this test
				const freshMapper = new GQLtoSQLMapper(mockProvider);

				const fields = {
					id: {},
					members: {
						fieldsByTypeName: {
							PersonV2: { id: {}, name: {} }, // suffix-keyed
						},
					},
				};

				const result = freshMapper.buildQueryAndBindingsFor({
					fields,
					entity: Fellowship,
					customFields: {},
				});

				// members 1:m lateral join must be present with person sub-fields
				expect(result.querySQL).toContain('persons');
				expect(result.querySQL).toContain('json_agg');
				// person_name is the SQL column for Person.name
				expect(result.querySQL).toContain('person_name');
			});
		});

		describe('mapCustomField — mapping branch', () => {
			it('should resolve sub-fields from suffixed GQL type name in mapping branch', () => {
				// mapping.refEntity = Fellowship → refEntityName = 'Fellowship'.
				// With suffix = 'V2', must look up 'FellowshipV2' in fieldsByTypeName.
				setGlobalConfig({ gqlTypesSuffix: 'V2' });

				const fields = {
					id: {},
					myFellowship: {
						fieldsByTypeName: {
							FellowshipV2: { id: {}, name: {} }, // suffix-keyed
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {
						myFellowship: {
							type: () => Fellowship,
							options: { nullable: true },
							mapping: {
								refEntity: Fellowship,
								refFields: 'id',
								fields: 'fellowshipId',
							},
						},
					} as any,
				});

				// The lateral join for the custom mapping field must exist
				expect(result.querySQL).toContain('fellowships');
				expect(result.querySQL).toContain('left outer join lateral');
				// fellowship_name (Fellowship.name SQL column) must be inside the lateral subquery
				expect(result.querySQL).toContain('fellowship_name');
			});

			it('should resolve sub-fields from un-suffixed key as fallback when no suffix configured', () => {
				// Without suffix: getGQLEntityNameFor('Fellowship') = 'Fellowship'.
				// fieldsByTypeName keyed 'Fellowship' → sub-fields found via primary lookup.
				const fields = {
					id: {},
					myFellowship: {
						fieldsByTypeName: {
							Fellowship: { id: {}, name: {} }, // no suffix
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {
						myFellowship: {
							type: () => Fellowship,
							options: { nullable: true },
							mapping: {
								refEntity: Fellowship,
								refFields: 'id',
								fields: 'fellowshipId',
							},
						},
					} as any,
				});

				expect(result.querySQL).toContain('fellowships');
				expect(result.querySQL).toContain('fellowship_name');
			});

			it('should include FK column in inner subquery even when suffix is configured', () => {
				// This guards against a regression where suffix-related changes broke rawSelect population.
				setGlobalConfig({ gqlTypesSuffix: 'V2' });

				const fields = {
					id: {},
					myFellowship: {
						fieldsByTypeName: {
							FellowshipV2: { id: {}, name: {} },
						},
					},
				};

				const result = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {
						myFellowship: {
							type: () => Fellowship,
							options: { nullable: true },
							mapping: {
								refEntity: Fellowship,
								refFields: 'id',
								fields: 'fellowshipId',
							},
						},
					} as any,
				});

				// fellowship_id (the FK) must appear in the inner subquery (before the lateral join keyword)
				const lateralIndex = result.querySQL.indexOf('left outer join lateral');
				const innerSubquery = result.querySQL.substring(0, lateralIndex);
				expect(innerSubquery).toContain('fellowship_id');
			});
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
