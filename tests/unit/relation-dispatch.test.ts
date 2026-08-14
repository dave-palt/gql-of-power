/**
 * Unit tests for the shared relation-dispatch helpers (src/queries/relation-dispatch.ts).
 *
 * getRelationCardinality() is THE single source of truth for the ownership
 * dispatch fixed in PR #46 (issue #45): an owning-side 1:1 (`inversedBy`) is
 * structurally a ManyToOne, an inverse-side 1:1 (`mappedBy`) is a OneToX.
 * Every mapper/filter/count dispatch site must agree with it.
 *
 * These tests pin:
 * 1. The dispatch matrix (ReferenceType × ownership → cardinality).
 * 2. That SQL-generating paths (selection, top-level filter, count field,
 *    inline field-arg filter) agree on the dispatch for 1:1 owning/inverse.
 * 3. The clear-error guards that replace the old TypeError crashes when
 *    metadata is incomplete (missing mappedBy target / missing pivot metadata).
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import {
	buildCorrelatedJoinCondition,
	getRelationCardinality,
	RelationCardinality,
} from '../../src/queries/relation-dispatch';
import { ReferenceType } from '../../src/types/sql-types';
import { Alias, AliasType } from '../../src/queries/alias';
import { Fellowship, Person, Weapon } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import { registerCountField, clearCountFields } from '../../src/entities/gql-entity';
import '../setup';

describe('relation-dispatch (shared ownership dispatch)', () => {
	describe('getRelationCardinality dispatch matrix', () => {
		it('1:m → ONE_TO_X', () => {
			expect(
				getRelationCardinality({
					type: 'Person',
					name: 'members',
					fieldNames: [],
					reference: ReferenceType.ONE_TO_MANY,
					mappedBy: 'fellowship',
					joinColumns: [],
					referencedColumnNames: [],
					inverseJoinColumns: [],
					pivotTable: '',
				})
			).toBe(RelationCardinality.ONE_TO_X);
		});

		it('m:1 → MANY_TO_ONE', () => {
			expect(
				getRelationCardinality({
					type: 'Fellowship',
					name: 'fellowship',
					fieldNames: ['fellowship_id'],
					reference: ReferenceType.MANY_TO_ONE,
					joinColumns: ['fellowship_id'],
					referencedColumnNames: ['id'],
					inverseJoinColumns: [],
					pivotTable: '',
				})
			).toBe(RelationCardinality.MANY_TO_ONE);
		});

		it('1:1 inverse side (mappedBy, no inversedBy) → ONE_TO_X (issue #45 rule)', () => {
			expect(
				getRelationCardinality({
					type: 'Ring',
					name: 'ring',
					fieldNames: [],
					reference: ReferenceType.ONE_TO_ONE,
					mappedBy: 'bearer',
					joinColumns: [],
					referencedColumnNames: [],
					inverseJoinColumns: [],
					pivotTable: '',
				})
			).toBe(RelationCardinality.ONE_TO_X);
		});

		it('1:1 owning side (inversedBy, no mappedBy) → MANY_TO_ONE (issue #45 rule)', () => {
			expect(
				getRelationCardinality({
					type: 'Weapon',
					name: 'signatureWeapon',
					fieldNames: ['signature_weapon_id'],
					reference: ReferenceType.ONE_TO_ONE,
					inversedBy: 'owner',
					joinColumns: ['signature_weapon_id'],
					referencedColumnNames: ['id'],
					inverseJoinColumns: [],
					pivotTable: '',
				})
			).toBe(RelationCardinality.MANY_TO_ONE);
		});

		it('m:n → MANY_TO_MANY', () => {
			expect(
				getRelationCardinality({
					type: 'Battle',
					name: 'battles',
					fieldNames: [],
					reference: ReferenceType.MANY_TO_MANY,
					joinColumns: ['person_id'],
					referencedColumnNames: ['id'],
					inverseJoinColumns: ['battle_id'],
					pivotTable: 'person_battles',
				})
			).toBe(RelationCardinality.MANY_TO_MANY);
		});

		it('scalar field (no reference) → undefined', () => {
			expect(
				getRelationCardinality({
					type: 'number',
					name: 'age',
					fieldNames: ['age'],
					joinColumns: [],
					referencedColumnNames: [],
					inverseJoinColumns: [],
					pivotTable: '',
				})
			).toBeUndefined();
		});
	});

	describe('SQL paths agree with the dispatch (1:1 ownership)', () => {
		let mapper: GQLtoSQLMapper;

		beforeEach(() => {
			mapper = new GQLtoSQLMapper(createMockMetadataProvider());
		});

		it('selection: owning 1:1 field maps via m:1 path (FK on this entity)', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					signatureWeapon: { fieldsByTypeName: { Weapon: { id: {}, name: {} } } },
				} as any,
				entity: Person,
				customFields: {} as any,
			});
			const sql = result.querySQL;
			expect(sql).toContain('signature_weapon_id');
			// m:1 path: parent FK = related PK — no phantom weapon-side FK column.
			expect(sql).not.toMatch(/weapons\.\\w+_id/);
		});

		it('selection: inverse 1:1 field maps via 1:x path (FK on related entity)', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					ring: { fieldsByTypeName: { Ring: { id: {}, name: {} } } },
				} as any,
				entity: Person,
				customFields: {} as any,
			});
			// 1:x path: join via the related entity's FK column (rings.bearer_id).
			expect(result.querySQL).toContain('bearer_id');
		});

		it('top-level filter: owning 1:1 filter joins on this entity FK (EXISTS)', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: { signatureWeapon: { name_eq: 'Andúril' } } as any,
			});
			expect(result.querySQL).toContain('signature_weapon_id');
			expect(result.querySQL.toLowerCase()).toContain('exists');
		});

		it('count field: owning-side 1:1 count subquery joins on this entity FK', () => {
			registerCountField('Person', 'weaponCount', 'signatureWeapon', () => 'Weapon');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, weaponCount: {} } as any,
				entity: Person,
				customFields: {} as any,
			});
			clearCountFields();

			const sql = result.querySQL;
			expect(sql).toContain('count(*)');
			// The count subquery must correlate on persons.signature_weapon_id (this
			// entity's FK), NOT on a weapon-side column — the exact #45 bug class.
			expect(sql).toContain('signature_weapon_id');
			expect(sql).not.toMatch(/weapons\\.\\w+_id/);
		});

		it('count field: inverse 1:1 count subquery joins via related FK', () => {
			registerCountField('Person', 'ringCount', 'ring', () => 'Ring');

			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, ringCount: {} } as any,
				entity: Person,
				customFields: {} as any,
			});
			clearCountFields();

			// Inverse side: FK lives on rings.bearer_id.
			expect(result.querySQL).toContain('bearer_id');
		});

		it('inline field-arg filter: inverse 1:1 selection filter works through mapOneToX', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: {
					id: {},
					ring: {
						args: { filter: { name_eq: 'The One Ring' } },
						fieldsByTypeName: { Ring: { id: {}, name: {} } },
					},
				} as any,
				entity: Person,
				customFields: {} as any,
			});
			expect(result.querySQL).toContain('bearer_id');
			expect(Object.values(result.bindings)).toContain('The One Ring');
		});
	});

	describe('clear-error guards (incomplete metadata)', () => {
		const parentAlias = new Alias(AliasType.entity, 1, 'a');
		const relatedAlias = new Alias(AliasType.entity, 1, 'w');

		it('throws a named error when mappedBy is missing on a one-to-x relation', () => {
			expect(() =>
				buildCorrelatedJoinCondition({
					fieldProps: {
						type: 'Ring',
						name: 'ring',
						fieldNames: [],
						reference: ReferenceType.ONE_TO_ONE,
						joinColumns: [],
						referencedColumnNames: [],
						inverseJoinColumns: [],
						pivotTable: '',
					},
					relatedMetadata: {
						tableName: 'rings',
						primaryKeys: ['id'],
						properties: {} as any,
					},
					parentPrimaryKeys: ['id'],
					parentAlias,
					relatedAlias,
				})
			).toThrow(/no "mappedBy"/);
		});

		it('throws a named error when the inverse property is not declared on the related entity', () => {
			expect(() =>
				buildCorrelatedJoinCondition({
					fieldProps: {
						type: 'Ring',
						name: 'ring',
						fieldNames: [],
						reference: ReferenceType.ONE_TO_ONE,
						mappedBy: 'bearer',
						joinColumns: [],
						referencedColumnNames: [],
						inverseJoinColumns: [],
						pivotTable: '',
					},
					relatedMetadata: {
						// bearer is NOT declared in properties → old code crashed with
						// "Cannot read properties of undefined (reading 'joinColumns')"
						tableName: 'rings',
						primaryKeys: ['id'],
						properties: { id: { type: 'number', name: 'id', fieldNames: ['id'] } } as any,
					},
					parentPrimaryKeys: ['id'],
					parentAlias,
					relatedAlias,
				})
			).toThrow(/inverse property "bearer".*not declared/s);
		});

		it('throws a named error when m:n pivot metadata is missing (inverse side)', () => {
			expect(() =>
				buildCorrelatedJoinCondition({
					fieldProps: {
						type: 'Battle',
						name: 'battles',
						fieldNames: [],
						reference: ReferenceType.MANY_TO_MANY,
						// inverse side of m:n carries no pivot metadata
						joinColumns: [],
						referencedColumnNames: [],
						inverseJoinColumns: [],
						pivotTable: '',
					},
					relatedMetadata: {
						tableName: 'battles',
						primaryKeys: ['id'],
						properties: {} as any,
					},
					parentPrimaryKeys: ['id'],
					parentAlias,
					relatedAlias,
				})
			).toThrow(/missing pivot metadata/);
		});

		it('returns empty SQL with a warning for scalar fields (no crash)', () => {
			const result = buildCorrelatedJoinCondition({
				fieldProps: {
					type: 'number',
					name: 'age',
					fieldNames: ['age'],
					joinColumns: [],
					referencedColumnNames: [],
					inverseJoinColumns: [],
					pivotTable: '',
				},
				relatedMetadata: {
					tableName: 'persons',
					primaryKeys: ['id'],
					properties: {} as any,
				},
				parentPrimaryKeys: ['id'],
				parentAlias,
				relatedAlias,
			});
			expect(result.sql).toBe('');
			expect(result.cardinality).toBeUndefined();
		});
	});

	describe('m:1 join SQL shape (unchanged behavior, now centralized)', () => {
		it('builds parent FK = related PK condition with fallback to related primaryKeys', () => {
			const result = buildCorrelatedJoinCondition({
				fieldProps: {
					type: 'Fellowship',
					name: 'fellowship',
					fieldNames: ['fellowship_id'],
					reference: ReferenceType.MANY_TO_ONE,
					joinColumns: ['fellowship_id'],
					referencedColumnNames: ['id'],
					inverseJoinColumns: [],
					pivotTable: '',
				},
				relatedMetadata: {
					tableName: 'fellowships',
					primaryKeys: ['id'],
					properties: {} as any,
				},
				parentPrimaryKeys: ['id'],
				parentAlias: new Alias(AliasType.entity, 1, 'a'),
				relatedAlias: new Alias(AliasType.entity, 1, 'w'),
			});
			expect(result.sql).toBe('e_a1.fellowship_id = e_w1.id');
			expect(result.cardinality).toBe(RelationCardinality.MANY_TO_ONE);
		});
	});
});
