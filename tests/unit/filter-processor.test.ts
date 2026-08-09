/**
 * Unit Tests for FilterProcessor
 *
 * Tests the filter processing logic that was extracted from GQLtoSQLMapper
 * including field operations, class operations (_and, _or, _not), and relationship filters.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { AliasManager } from '../../src/queries/alias';
import { FilterProcessor } from '../../src/queries/filter-processor';
import { QueriesUtils } from '../../src/queries/utils';
import { EntityMetadata, GQLEntityFilterInputFieldType, MappingsType } from '../../src/types';
import { Fellowship, Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('FilterProcessor', () => {
	let filterProcessor: FilterProcessor;
	let aliasManager: AliasManager;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;
	let mockRecursiveMapFunction: any;

	beforeEach(() => {
		aliasManager = new AliasManager();
		mockProvider = createMockMetadataProvider();

		// Mock the recursive map function
		mockRecursiveMapFunction = mock(() => new Map<string, MappingsType>());

		filterProcessor = new FilterProcessor(aliasManager, mockProvider, mockRecursiveMapFunction);
	});

	describe('mapFilter', () => {
		it('should handle simple field operations', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter: GQLEntityFilterInputFieldType<Person> = {
				name_eq: 'Frodo',
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'name_eq', filter);

			const nameEqMapping = mappings.get('name_eq');
			expect(nameEqMapping).toBeDefined();
			expect(nameEqMapping!.where).toHaveLength(1);
			expect(nameEqMapping!.where[0]).toContain('person_name');
			expect(nameEqMapping!.where[0]).toContain('=');
			expect(Object.values(nameEqMapping!.values)).toContain('Frodo');
		});

		it('should handle IN operations with arrays', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter: GQLEntityFilterInputFieldType<Person> = {
				race_in: ['Hobbit', 'Elf', 'Dwarf'] as any,
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'race_in', filter);

			const raceInMapping = mappings.get('race_in');
			expect(raceInMapping).toBeDefined();
			expect(raceInMapping!.where).toHaveLength(1);
			expect(raceInMapping!.where[0]).toContain('in (');
			expect(Object.values(raceInMapping!.values)).toEqual(['Hobbit', 'Elf', 'Dwarf']);
		});

		it('should handle direct field filtering with implicit _eq', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter: GQLEntityFilterInputFieldType<Person> = {
				age: 50 as any,
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'age', filter);

			const ageMapping = mappings.get('age');
			expect(ageMapping).toBeDefined();
			expect(ageMapping!.where).toHaveLength(1);
			expect(ageMapping!.where[0]).toContain('=');
			expect(Object.values(ageMapping!.values)).toContain(50);
		});

		it('should handle class operations (_and, _or, _not)', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter: GQLEntityFilterInputFieldType<Person> = {
				_or: [{ name: 'Frodo' as any }, { race: 'Hobbit' as any }],
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, '_or', filter);

			const orMapping = mappings.get('_or');
			expect(orMapping).toBeDefined();
			expect(orMapping!.alias).toBe(alias);
		});

		it('should handle nested object filter values', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter = {
				age: { _gt: 30, _lt: 100 } as any,
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'age', filter as any);

			const ageMapping = mappings.get('age');
			expect(ageMapping).toBeDefined();
			expect(ageMapping!.where).toHaveLength(2); // One for _gt and one for _lt
		});

		it('should handle relationship filters', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Mock the recursive map function to return some mappings
			const mockRelationshipMappings = new Map<string, MappingsType>();
			const mockMapping = QueriesUtils.newMappings();
			mockMapping.where.push('f.fellowship_name = :fellowship_name');
			mockMapping.values = { fellowship_name: 'Fellowship of the Ring' };
			mockRelationshipMappings.set('test', mockMapping);

			mockRecursiveMapFunction.mockImplementation(() => mockRelationshipMappings);

			const filter: GQLEntityFilterInputFieldType<Person> = {
				fellowship: { name: 'Fellowship of the Ring' } as any,
			};

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'fellowship', filter);

			expect(mockRecursiveMapFunction).toHaveBeenCalled();
			const fellowshipMapping = mappings.get('fellowship');
			expect(fellowshipMapping).toBeDefined();
		});

		it('should throw error for unknown field', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filter = {
				unknownField: 'value',
			};

			expect(() => {
				filterProcessor.mapFilter(
					personMetadata,
					mappings,
					parentAlias,
					alias,
					'unknownField' as any,
					filter as any
				);
			}).toThrow('not found in properties nor in customFields');
		});
	});

	describe('applyFilterValue', () => {
		it('should apply primitive filter values', () => {
			const mapping = QueriesUtils.newMappings();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			filterProcessor.applyFilterValue({
				filterValue: 'Frodo',
				fieldOperation: '_eq',
				fieldName: 'person_name',
				parentAlias,
				alias,
				mapping,
			});

			expect(mapping.where).toHaveLength(1);
			expect(mapping.where[0]).toContain('person_name');
			expect(mapping.where[0]).toContain('=');
			expect(Object.values(mapping.values)).toContain('Frodo');
		});

		it('should apply object filter values with multiple operations', () => {
			const mapping = QueriesUtils.newMappings();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const filterValue = {
				_gt: 30,
				_lt: 100,
			};

			filterProcessor.applyFilterValue({
				filterValue: filterValue as any,
				fieldOperation: '_eq', // This will be overridden by the object properties
				fieldName: 'age',
				parentAlias,
				alias,
				mapping,
			});

			expect(mapping.where).toHaveLength(2); // One for _gt and one for _lt
			expect(mapping.where.some((w) => w.includes('>'))).toBe(true);
			expect(mapping.where.some((w) => w.includes('<'))).toBe(true);
		});

		it('should handle null values correctly', () => {
			const mapping = QueriesUtils.newMappings();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			filterProcessor.applyFilterValue({
				filterValue: null,
				fieldOperation: '_eq',
				fieldName: 'age',
				parentAlias,
				alias,
				mapping,
			});

			expect(mapping.where).toHaveLength(1);
			expect(mapping.where[0]).toContain('is null');
		});
	});

	describe('_or operations', () => {
		it('should handle OR operations correctly', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const gqlFilters = [{ name: 'Frodo' as any }, { race: 'Hobbit' as any }];

			filterProcessor._or({
				entityMetadata: personMetadata,
				gqlFilters,
				parentAlias,
				alias,
				fieldName: '_or',
				mapping,
				mappings,
			});

			expect(mapping._or).toHaveLength(2);
		});

		it('should skip undefined filter values in OR', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const gqlFilters = [{ name: 'Frodo' as any, age: undefined }, { race: 'Hobbit' as any }];

			filterProcessor._or({
				entityMetadata: personMetadata,
				gqlFilters,
				parentAlias,
				alias,
				fieldName: '_or',
				mapping,
				mappings,
			});

			// Should still process 2 filters but skip undefined values
			expect(mapping._or).toHaveLength(2);
		});
	});

	describe('_and operations', () => {
		it('should handle AND operations correctly', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Mock recursive map to return some mappings
			const mockMappings = new Map<string, MappingsType>();
			const testMapping = QueriesUtils.newMappings();
			testMapping.where.push('test_where');
			mockMappings.set('test', testMapping);
			mockRecursiveMapFunction.mockImplementation(() => mockMappings);

			const gqlFilters = [{ name: 'Frodo' as any }, { race: 'Hobbit' as any }];

			filterProcessor._and({
				entityMetadata: personMetadata,
				gqlFilters,
				parentAlias,
				alias,
				fieldName: '_and',
				mapping,
				mappings,
			});

			expect(mockRecursiveMapFunction).toHaveBeenCalledTimes(2);
		});
	});

	describe('_not operations', () => {
		it('should negate a single direct field condition', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Mock recursiveMapFunction to return a where clause for the name field
			const mockMappings = new Map<string, MappingsType>();
			const testMapping = QueriesUtils.newMappings();
			testMapping.where.push('e_p2.person_name = :v_not_val');
			testMapping.values = { v_not_val: 'Frodo' };
			mockMappings.set('name', testMapping);
			mockRecursiveMapFunction.mockImplementation(() => mockMappings);

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: [{ name: 'Frodo' as any }],
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(mapping.where).toHaveLength(1);
			expect(mapping.where[0]).toContain('not (');
			expect(mapping.where[0]).toContain('person_name');
			expect(Object.values(mapping.values)).toContain('Frodo');
		});

		it('should negate a conjunction of multiple conditions with AND inside NOT', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Mock returns different where per call
			let callIdx = 0;
			const nameMapping = QueriesUtils.newMappings();
			nameMapping.where.push('e_p2.person_name = :v_not_name');
			nameMapping.values = { v_not_name: 'Frodo' };

			const raceMapping = QueriesUtils.newMappings();
			raceMapping.where.push('e_p2.race = :v_not_race');
			raceMapping.values = { v_not_race: 'Hobbit' };

			mockRecursiveMapFunction.mockImplementation(() => {
				const m = callIdx === 0 ? nameMapping : raceMapping;
				callIdx++;
				const mm = new Map<string, MappingsType>();
				mm.set('f', m);
				return mm;
			});

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: [{ name: 'Frodo' as any }, { race: 'Hobbit' as any }],
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(mapping.where).toHaveLength(1);
			// NOT (cond1 AND cond2)
			expect(mapping.where[0]).toMatch(/^not \(/);
			expect(mapping.where[0]).toContain(' and ');
			expect(mapping.where[0]).toContain('person_name');
			expect(mapping.where[0]).toContain('race');
			expect(Object.values(mapping.values)).toContain('Frodo');
			expect(Object.values(mapping.values)).toContain('Hobbit');
		});

		it('should handle a single filter object (not wrapped in array)', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const mockMappings = new Map<string, MappingsType>();
			const testMapping = QueriesUtils.newMappings();
			testMapping.where.push('e_p2.person_name = :v_not_sauron');
			testMapping.values = { v_not_sauron: 'Sauron' };
			mockMappings.set('name', testMapping);
			mockRecursiveMapFunction.mockImplementation(() => mockMappings);

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: { name: 'Sauron' as any } as any,
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(mapping.where).toHaveLength(1);
			expect(mapping.where[0]).toContain('not (');
			expect(Object.values(mapping.values)).toContain('Sauron');
		});

		it('should produce no where clause for an empty filter array', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: [],
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(mapping.where).toHaveLength(0);
		});

		it('should warn when _or is nested inside _not', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Set up mock to return a mapping with _or entries
			const mockMappings = new Map<string, MappingsType>();
			const orMapping = QueriesUtils.newMappings();
			orMapping._or.push(QueriesUtils.newMappings());
			mockMappings.set('_or', orMapping);
			mockRecursiveMapFunction.mockImplementation(() => mockMappings);

			// Enable logging for this test — logger.warn is gated by shouldLog()
			const originalLogType = process.env.D3GOP_LOG_TYPE;
			process.env.D3GOP_LOG_TYPE = 'FilterProcessor';

			const originalWarn = console.warn;
			let warnCallCount = 0;
			let lastWarnMessage = '';
			console.warn = (message: any) => {
				warnCallCount++;
				lastWarnMessage = message;
			};

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: [{ _or: [{ name: 'Frodo' as any }] } as any],
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(warnCallCount).toBeGreaterThanOrEqual(1);
			expect(lastWarnMessage).toContain('nested _or inside _not');

			console.warn = originalWarn;
			process.env.D3GOP_LOG_TYPE = originalLogType;
		});
	});

	describe('integration scenarios', () => {
		it('should handle complex nested filters', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const complexFilter = {
				_or: [
					{
						name_eq: 'Frodo',
						age: { _gt: 30 } as any,
					},
					{
						_and: [{ race: 'Hobbit' as any }, { age: { _lt: 50 } as any }],
					},
				],
			};

			// Test mapping the _or part
			filterProcessor.mapFilter(
				personMetadata,
				mappings,
				parentAlias,
				alias,
				'_or',
				complexFilter as any
			);

			const orMapping = mappings.get('_or');
			expect(orMapping).toBeDefined();
			expect(orMapping!.alias).toBe(alias);
		});

		it('should handle Fellowship members with complex filtering', () => {
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('f');
			const alias = aliasManager.start('f');

			// Mock relationship filtering
			const mockRelationshipMappings = new Map<string, MappingsType>();
			const memberMapping = QueriesUtils.newMappings();
			memberMapping.where.push('p.race = :race');
			memberMapping.values = { race: 'Hobbit' };
			mockRelationshipMappings.set('members', memberMapping);
			mockRecursiveMapFunction.mockImplementation(() => mockRelationshipMappings);

			const filter = {
				members: {
					race: 'Hobbit',
				},
			};

			filterProcessor.mapFilter(
				fellowshipMetadata,
				mappings,
				parentAlias,
				alias,
				'members',
				filter as any
			);

			expect(mockRecursiveMapFunction).toHaveBeenCalled();
			const membersMapping = mappings.get('members');
			expect(membersMapping).toBeDefined();
		});

		it('should handle multiple field operations on same field', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			// Apply multiple operations to age field
			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'age_gt', {
				age_gt: 18,
			} as any);

			filterProcessor.mapFilter(personMetadata, mappings, parentAlias, alias, 'age_lt', {
				age_lt: 150,
			} as any);

			const gtMapping = mappings.get('age_gt');
			const ltMapping = mappings.get('age_lt');

			expect(gtMapping).toBeDefined();
			expect(ltMapping).toBeDefined();
			expect(gtMapping!.where[0]).toContain('>');
			expect(ltMapping!.where[0]).toContain('<');
		});
	});

	describe('_or with _and expansion', () => {
		it('should expand _and entries within _or into separate OR branches with populated where', () => {
			const provider = createMockMetadataProvider();
			const am = new AliasManager();

			let processor: FilterProcessor;
			const recursiveMap = (params: any) => {
				const { entityMetadata, gqlFilters, parentAlias, alias } = params;
				const ms = new Map<string, MappingsType>();
				for (const f of gqlFilters ?? []) {
					for (const key of Object.keys(f ?? {})) {
						if (f[key] === undefined) continue;
						processor.mapFilter(entityMetadata, ms, parentAlias, alias, key, f);
					}
				}
				return ms;
			};
			processor = new FilterProcessor(am, provider, recursiveMap as any);
			filterProcessor = processor;

			const personMetadata = provider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = am.start('p');
			const alias = am.start('p');

			const gqlFilters = [
				{ _and: [{ race_eq: 'Hobbit' as any }, { age: { _lt: 50 } as any }] },
				{ _and: [{ race_eq: 'Elf' as any }, { age: { _gt: 100 } as any }] },
			];

			processor._or({
				entityMetadata: personMetadata,
				gqlFilters,
				parentAlias,
				alias,
				fieldName: '_or',
				mapping,
				mappings,
			});

			expect(mapping._or).toHaveLength(2);
			expect(mapping._or[0].where.length).toBeGreaterThan(0);
			expect(mapping._or[1].where.length).toBeGreaterThan(0);
			expect(mapping._or[0].where.some((w) => w.includes('race'))).toBe(true);
			expect(mapping._or[0].where.some((w) => w.includes('age'))).toBe(true);
			expect(mapping._or[1].where.some((w) => w.includes('race'))).toBe(true);
			expect(mapping._or[1].where.some((w) => w.includes('age'))).toBe(true);
		});

		it('should expand _and with nested _or into Cartesian product of OR branches', () => {
			const provider = createMockMetadataProvider();
			const am = new AliasManager();

			let processor: FilterProcessor;
			const recursiveMap = (params: any) => {
				const { entityMetadata, gqlFilters, parentAlias, alias } = params;
				const ms = new Map<string, MappingsType>();
				for (const f of gqlFilters ?? []) {
					for (const key of Object.keys(f ?? {})) {
						if (f[key] === undefined) continue;
						processor.mapFilter(entityMetadata, ms, parentAlias, alias, key, f);
					}
				}
				return ms;
			};
			processor = new FilterProcessor(am, provider, recursiveMap as any);
			filterProcessor = processor;

			const personMetadata = provider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = am.start('p');
			const alias = am.start('p');

			const gqlFilters = [
				{
					_and: [
						{ race_eq: 'Hobbit' as any },
						{ _or: [{ home: 'The Shire' as any }, { home: 'Rivendell' as any }] },
					],
				},
			];

			processor._or({
				entityMetadata: personMetadata,
				gqlFilters,
				parentAlias,
				alias,
				fieldName: '_or',
				mapping,
				mappings,
			});

			expect(mapping._or).toHaveLength(2);
			expect(mapping._or[0].where.some((w) => w.includes('race'))).toBe(true);
			expect(mapping._or[0].where.some((w) => w.includes('home_location'))).toBe(true);
			expect(mapping._or[1].where.some((w) => w.includes('race'))).toBe(true);
			expect(mapping._or[1].where.some((w) => w.includes('home_location'))).toBe(true);
		});
	});
});
