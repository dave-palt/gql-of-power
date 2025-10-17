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
			expect(Object.values(raceInMapping!.values)).toEqual([['Hobbit', 'Elf', 'Dwarf']]);
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
		it('should warn about unimplemented _not operation', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const mapping = QueriesUtils.newMappings();
			const mappings = new Map<string, MappingsType>();
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.start('p');

			const originalWarn = console.warn;
			let warnCallCount = 0;
			let lastWarnMessage = '';
			console.warn = (message: any) => {
				warnCallCount++;
				lastWarnMessage = message;
			};

			filterProcessor._not({
				entityMetadata: personMetadata,
				gqlFilters: [],
				parentAlias,
				alias,
				fieldName: '_not',
				mapping,
				mappings,
			});

			expect(warnCallCount).toBe(1);
			expect(lastWarnMessage).toBe('FilterProcessor - _not operation not yet implemented');
			console.warn = originalWarn;
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
});
