/**
 * Unit Tests for RelationshipHandler
 *
 * Tests the relationship mapping logic for One-to-Many, Many-to-One,
 * and Many-to-Many relationships extracted from GQLtoSQLMapper.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { AliasManager, AliasType } from '../../src/queries/alias';
import { newMappings } from '../../src/queries/gql-to-sql-mapper';
import { RelationshipHandler } from '../../src/queries/relationship-handler';
import { EntityMetadata, EntityProperty, ReferenceType } from '../../src/types';
import { Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('RelationshipHandler', () => {
	let relationshipHandler: RelationshipHandler;
	let aliasManager: AliasManager;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		aliasManager = new AliasManager();
		relationshipHandler = new RelationshipHandler(aliasManager);
		mockProvider = createMockMetadataProvider();
	});

	describe('mapOneToX', () => {
		it('should handle One-to-Many relationship for Fellowship members', () => {
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;

			// Fellowship has many members (persons)
			const fieldProps = fellowshipMetadata.properties.members as EntityProperty;
			const parentAlias = aliasManager.start('f');
			const alias = aliasManager.next(AliasType.field, 'p');
			const mapping = newMappings();

			const mockJson = ["'id'", 'p.id', "'name'", 'p.person_name'];
			const mockSelect = new Set(['p.id', 'p.person_name']);
			const mockWhereWithValues = ['p.race = :race'];
			const mockValues = { race: 'Hobbit' };

			relationshipHandler.mapOneToX(
				personMetadata,
				fieldProps,
				mapping,
				parentAlias,
				alias,
				mockWhereWithValues,
				mockValues,
				undefined, // limit
				undefined, // offset
				[], // orderBy
				'members',
				mockJson,
				mockSelect,
				[], // filterJoin
				[] // join
			);

			expect(mapping.json).toContain("'members', f_p1.value");
			expect(mapping.join).toHaveLength(1);
			expect(mapping.join[0]).toContain('left outer join lateral');
			expect(mapping.join[0]).toContain('json_agg');
			expect(mapping.values).toEqual(mockValues);
		});

		it('should handle One-to-One relationship for Person ring', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const ringMetadata = mockProvider.getMetadata('Ring') as EntityMetadata<Ring>;

			// Person has one ring
			const fieldProps = personMetadata.properties.ring as EntityProperty;
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'r');
			const mapping = newMappings();

			const mockJson = ["'id'", 'r.id', "'name'", 'r.ring_name'];
			const mockSelect = new Set(['r.id', 'r.ring_name']);

			relationshipHandler.mapOneToX(
				ringMetadata,
				fieldProps,
				mapping,
				parentAlias,
				alias,
				[], // whereWithValues
				{}, // values
				undefined, // limit
				undefined, // offset
				[], // orderBy
				'ring',
				mockJson,
				mockSelect,
				[], // filterJoin
				[] // join
			);

			expect(mapping.json).toContain("'ring', f_r1.value");
			expect(mapping.join).toHaveLength(1);
			expect(mapping.join[0]).toContain('left outer join lateral');
			// One-to-One should NOT have json_agg
			expect(mapping.join[0]).toContain('row_to_json');
			expect(mapping.join[0]).not.toContain('json_agg');
		});

		it('should handle pagination and ordering for One-to-Many', () => {
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;

			const fieldProps = fellowshipMetadata.properties.members as EntityProperty;
			const parentAlias = aliasManager.start('f');
			const alias = aliasManager.next(AliasType.field, 'p');
			const mapping = newMappings();

			const mockOrderBy = [{ name: 'asc' as const }, { age: 'desc' as const }];

			relationshipHandler.mapOneToX(
				personMetadata,
				fieldProps,
				mapping,
				parentAlias,
				alias,
				[], // whereWithValues
				{}, // values
				10, // limit
				5, // offset
				mockOrderBy,
				'members',
				["'id'", 'p.id'],
				new Set(['p.id']),
				[], // filterJoin
				[] // join
			);

			expect(mapping.join[0]).toContain('limit 10');
			expect(mapping.join[0]).toContain('offset 5');
			expect(mapping.join[0]).toContain('order by');
		});

		it('should throw error for mismatched join column lengths', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const fieldProps = {
				...personMetadata.properties.ring,
				mappedBy: 'invalidMappedBy',
			} as EntityProperty;

			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'r');
			const mapping = newMappings();

			// Mock invalid reference field with mismatched columns
			const invalidReferenceField = {
				...mockProvider.getMetadata('Ring'),
				properties: {
					invalidMappedBy: {
						joinColumns: ['col1', 'col2'], // 2 columns
						referencedColumnNames: ['ref1'], // 1 column - mismatch!
					} as EntityProperty,
				},
			} as EntityMetadata<any>;

			expect(() => {
				relationshipHandler.mapOneToX(
					invalidReferenceField,
					fieldProps,
					mapping,
					parentAlias,
					alias,
					[],
					{},
					undefined,
					undefined,
					[],
					'ring',
					[],
					new Set(),
					[],
					[]
				);
			}).toThrow('joins with different number of columns 2 !== 1');
		});
	});

	describe('mapManyToOne', () => {
		it('should handle Many-to-One relationship for Person fellowship', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;

			// Person belongs to one fellowship
			const fieldProps = personMetadata.properties.fellowship as EntityProperty;
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'f');
			const mapping = newMappings();

			const mockJson = ["'id'", 'f.id', "'name'", 'f.fellowship_name'];
			const mockSelect = new Set(['f.id', 'f.fellowship_name']);

			relationshipHandler.mapManyToOne(
				fieldProps,
				fellowshipMetadata,
				parentAlias,
				alias,
				mapping,
				[], // whereWithValues
				{}, // values
				[], // filterJoin
				undefined, // limit
				undefined, // offset
				'fellowship',
				mockSelect,
				mockJson,
				[] // join
			);

			// The RelationshipHandler should add the join field to select
			expect(mapping.select.size).toBeGreaterThan(0);
			expect(mapping.json).toContain("'fellowship', f_f1.value");
			expect(mapping.join).toHaveLength(1);
			expect(mapping.join[0]).toContain('left outer join lateral');
			expect(mapping.join[0]).toContain('row_to_json');
		});

		it('should throw error for mismatched field lengths', () => {
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;

			// Create invalid field props with mismatched lengths
			const invalidFieldProps = {
				...personMetadata.properties.fellowship,
				fieldNames: ['field1', 'field2'], // 2 fields
			} as EntityProperty;

			// Fellowship has 1 primary key, but fieldNames has 2 - mismatch!
			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'f');
			const mapping = newMappings();

			expect(() => {
				relationshipHandler.mapManyToOne(
					invalidFieldProps,
					fellowshipMetadata,
					parentAlias,
					alias,
					mapping,
					[],
					{},
					[],
					undefined,
					undefined,
					'fellowship',
					new Set(),
					[],
					[]
				);
			}).toThrow('Mismatch in lengths');
		});
	});

	describe('mapManyToMany', () => {
		it('should handle Many-to-Many relationship', () => {
			// Create a mock many-to-many relationship
			const parentMetadata = {
				name: 'Person',
				tableName: 'persons',
				primaryKeys: ['id'],
				properties: {},
			} as EntityMetadata<any>;

			const referenceMetadata = {
				name: 'Battle',
				tableName: 'battles',
				primaryKeys: ['id'],
				properties: {},
			} as EntityMetadata<any>;

			const fieldProps = {
				name: 'battles',
				type: 'Battle',
				reference: ReferenceType.MANY_TO_MANY,
				fieldNames: [],
				mappedBy: '',
				joinColumns: ['person_id'],
				referencedColumnNames: [],
				inverseJoinColumns: ['battle_id'],
				pivotTable: 'person_battles',
			} as EntityProperty;

			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'b');
			const mapping = newMappings();

			const mockJson = ["'id'", 'b.id', "'name'", 'b.battle_name'];
			const mockSelect = new Set(['b.id', 'b.battle_name']);

			relationshipHandler.mapManyToMany(
				referenceMetadata,
				['id'], // primaryKeys
				fieldProps,
				parentAlias,
				alias,
				mockSelect,
				[], // whereWithValues
				[], // join
				mockJson,
				mapping,
				'battles',
				{}, // values
				undefined, // limit
				undefined, // offset
				[] // orderBy
			);

			expect(mapping.json).toContain("'battles', f_b1.value");
			expect(mapping.join).toHaveLength(1);
			expect(mapping.join[0]).toContain('left outer join lateral');
			expect(mapping.join[0]).toContain('person_battles');
			expect(mapping.join[0]).toContain('json_agg');
		});

		it('should handle null values when no pivot table conditions', () => {
			const referenceMetadata = {
				name: 'Battle',
				tableName: 'battles',
				primaryKeys: ['id'],
				properties: {},
			} as EntityMetadata<any>;

			const fieldProps = {
				joinColumns: ['person_id'], // Fix: provide matching join columns
				inverseJoinColumns: ['battle_id'],
				pivotTable: 'person_battles',
			} as EntityProperty;

			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'b');
			const mapping = newMappings();

			// Test with empty whereWithValues to simulate null conditions
			relationshipHandler.mapManyToMany(
				referenceMetadata,
				['id'], // primaryKeys
				fieldProps,
				parentAlias,
				alias,
				new Set(['b.id']),
				[], // empty whereWithValues should still create join
				[],
				["'id', b.id"],
				mapping,
				'battles',
				{},
				undefined,
				undefined,
				[]
			);

			// Should still create a join even with empty conditions
			expect(mapping.json).toContain("'battles', f_b1.value");
			expect(mapping.join).toHaveLength(1);
		});

		it('should throw error for mismatched primary key lengths', () => {
			const referenceMetadata = {
				primaryKeys: ['id1', 'id2'], // 2 primary keys
			} as EntityMetadata<any>;

			const fieldProps = {
				joinColumns: ['person_id'], // 1 join column
				inverseJoinColumns: ['battle_id'],
				pivotTable: 'person_battles',
			} as EntityProperty;

			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'b');
			const mapping = newMappings();

			expect(() => {
				relationshipHandler.mapManyToMany(
					referenceMetadata,
					['id1', 'id2'], // 2 primary keys
					fieldProps,
					parentAlias,
					alias,
					new Set(),
					[],
					[],
					[],
					mapping,
					'battles',
					{},
					undefined,
					undefined,
					[]
				);
			}).toThrow('m:m joins with different number of columns 2 !== 1');
		});

		it('should throw error for mismatched inverse join column lengths', () => {
			const referenceMetadata = {
				primaryKeys: ['id'], // 1 primary key
			} as EntityMetadata<any>;

			const fieldProps = {
				joinColumns: ['person_id'],
				inverseJoinColumns: ['battle_id1', 'battle_id2'], // 2 inverse join columns
				pivotTable: 'person_battles',
			} as EntityProperty;

			const parentAlias = aliasManager.start('p');
			const alias = aliasManager.next(AliasType.field, 'b');
			const mapping = newMappings();

			expect(() => {
				relationshipHandler.mapManyToMany(
					referenceMetadata,
					['id'], // 1 primary key
					fieldProps,
					parentAlias,
					alias,
					new Set(),
					[],
					[],
					[],
					mapping,
					'battles',
					{},
					undefined,
					undefined,
					[]
				);
			}).toThrow('m:m joins with different number of columns 1 !== 2');
		});
	});

	describe('integration scenarios', () => {
		it('should handle complex Fellowship with members and quest', () => {
			const fellowshipMetadata = mockProvider.getMetadata(
				'Fellowship'
			) as EntityMetadata<Fellowship>;
			const personMetadata = mockProvider.getMetadata('Person') as EntityMetadata<Person>;

			const membersFieldProps = fellowshipMetadata.properties.members as EntityProperty;
			const parentAlias = aliasManager.start('f');
			const membersAlias = aliasManager.next(AliasType.field, 'p');
			const mapping = newMappings();

			// Test with complex filtering and ordering
			const mockOrderBy = [{ name: 'asc' as const }, { race: 'desc' as const }];

			const mockWhereWithValues = ['p.race = :race', 'p.age > :min_age'];

			const mockValues = {
				race: 'Hobbit',
				min_age: 30,
			};

			relationshipHandler.mapOneToX(
				personMetadata,
				membersFieldProps,
				mapping,
				parentAlias,
				membersAlias,
				mockWhereWithValues,
				mockValues,
				5, // limit
				0, // offset
				mockOrderBy,
				'members',
				["'id'", 'p.id', "'name'", 'p.person_name', "'race'", 'p.race'],
				new Set(['p.id', 'p.person_name', 'p.race']),
				[], // filterJoin
				[] // join
			);

			const generatedJoin = mapping.join[0];

			// Verify the query structure
			expect(generatedJoin).toContain('left outer join lateral');
			expect(generatedJoin).toContain('json_agg');
			expect(generatedJoin).toContain('limit 5');
			expect(generatedJoin).toContain('order by');
			expect(generatedJoin).toContain('p.race = :race');
			expect(generatedJoin).toContain('p.age > :min_age');

			expect(mapping.values).toEqual(mockValues);
		});
	});
});
