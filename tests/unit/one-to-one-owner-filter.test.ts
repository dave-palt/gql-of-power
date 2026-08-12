/**
 * Unit tests for owning-side OneToOne filter join direction.
 *
 * Regression coverage for issue #45: filtering on an owning-side OneToOne
 * relation (FK column on THIS entity, `inversedBy` set) must join using this
 * entity's own FK column — the same path as ManyToOne. The inverse side
 * (`mappedBy` set, `inversedBy` empty) continues to join via the related
 * entity's FK column.
 *
 * These tests assert SQL shape only (no DB needed). They verify the dispatch
 * in FilterProcessor (handleReferenceFieldFilter + buildCountSubquerySQL) and
 * the mapper's count-subquery join builder all agree on `inversedBy` as the
 * ownership signal.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Fellowship, Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('Owning-side OneToOne filter — join direction (issue #45)', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
	});

	describe('owning side (FK on THIS entity → mapManyToOne path)', () => {
		it('Person.signatureWeapon filter joins on persons.signature_weapon_id', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: {
					signatureWeapon: { name_eq: 'Andúril' },
				} as any,
			});

			const sql = result.querySQL;
			expect(sql.toLowerCase()).toContain('exists');
			// FK is on persons (this entity) → persons.signature_weapon_id = weapons.id
			expect(sql).toContain('signature_weapon_id');
			// Must NOT reference a phantom FK column on the weapon side.
			expect(sql).not.toMatch(/weapons\.\w+_id/);
		});

		it('Person.signatureArtifact filter joins on persons.signature_artifact_id', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: {
					signatureArtifact: { name_eq: 'Silmaril' },
				} as any,
			});

			const sql = result.querySQL;
			expect(sql.toLowerCase()).toContain('exists');
			expect(sql).toContain('signature_artifact_id');
			expect(sql).not.toMatch(/artifacts?\.\w+_id/);
		});

		it('binds the filter value as a SQL parameter', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: {
					signatureWeapon: { name_eq: 'Glamdring' },
				} as any,
			});

			expect(Object.values(result.bindings)).toContain('Glamdring');
		});
	});

	describe('inverse side (FK on RELATED entity → mapOneToX path, unchanged)', () => {
		it('Person.ring filter still resolves via the related ring.bearer_id (regression guard)', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: {
					ring: { name_eq: 'The One Ring' },
				} as any,
			});

			const sql = result.querySQL;
			expect(sql.toLowerCase()).toContain('exists');
			// ring is the inverse side: mappedBy: 'bearer', inversedBy: ''.
			// The FK lives on rings.bearer_id — the related entity's column.
			expect(sql).toContain('bearer_id');
		});
	});

	describe('ManyToOne filter (unchanged by this fix)', () => {
		it('Person.fellowship filter still joins on persons.fellowship_id', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Person,
				customFields: {} as any,
				filter: {
					fellowship: { name_eq: 'Fellowship of the Ring' },
				} as any,
			});

			const sql = result.querySQL;
			expect(sql.toLowerCase()).toContain('exists');
			expect(sql).toContain('fellowship_id');
		});
	});

	describe('top-level relation filter on a parent entity (EXISTS regression)', () => {
		it('Fellowship.members filter generates EXISTS (not affected by 1:1 fix)', () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: { id: {}, name: {} } as any,
				entity: Fellowship,
				customFields: {} as any,
				filter: {
					members: { name_eq: 'Frodo' },
				} as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
		});
	});
});
