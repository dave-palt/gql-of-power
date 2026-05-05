import { beforeEach, describe, expect, it } from 'bun:test';
import {
	defineFields,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

class TestWarrior {
	id!: number;
	name!: string;
}

class TestWeapon {
	id!: number;
	name!: string;
}

enum WeaponType {
	Sword = 'SWORD',
	Bow = 'BOW',
	Staff = 'STAFF',
}

describe('_resolveRelatedEntityNames guard', () => {
	beforeEach(() => {
		setGlobalConfig({ gqlTypesSuffix: '' });
	});

	it('should derive relatedEntityName for array field with GQLEntityBase type', () => {
		@GQLEntityClass(TestWeapon, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
		})
		class TestWeaponGQL extends GQLEntityBase {}

		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			weapons: {
				type: () => TestWeaponGQL,
				array: true,
				generateFilter: true,
			},
		});

		@GQLEntityClass(TestWarrior, fields)
		class TestWarriorGQL extends GQLEntityBase {}

		expect(TestWarriorGQL.gqlEntityName).toBe('TestWarrior');
		expect(TestWarriorGQL.FilterInput).toBeDefined();
	});

	it('should not derive relatedEntityName for array field with enum type', () => {
		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			weaponTypes: {
				type: () => WeaponType,
				array: true,
			},
		});

		expect(() => {
			@GQLEntityClass(TestWarrior, fields)
			class TestWarriorEnumArrayGQL extends GQLEntityBase {}
		}).not.toThrow();
	});

	it('should not derive relatedEntityName for array field with primitive type', () => {
		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			tags: {
				type: () => String,
				array: true,
			},
		});

		expect(() => {
			@GQLEntityClass(TestWarrior, fields)
			class TestWarriorTagsGQL extends GQLEntityBase {}
		}).not.toThrow();
	});

	it('should preserve explicit relatedEntityName on array field', () => {
		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			weapons: {
				type: () => String,
				array: true,
				relatedEntityName: () => 'TestWeapon',
				generateFilter: true,
			},
		});

		@GQLEntityClass(TestWarrior, fields)
		class TestWarriorExplicitGQL extends GQLEntityBase {}

		expect(TestWarriorExplicitGQL.gqlEntityName).toBe('TestWarrior');
		expect(TestWarriorExplicitGQL.FilterInput).toBeDefined();
	});

	it('should handle createGQLEntity with non-entity array field', async () => {
		const { createGQLEntity } = await import('../../src/entities/gql-entity');

		const entityDef = createGQLEntity(TestWarrior, {
			id: { type: () => String },
			name: { type: () => String },
			tags: {
				type: () => String,
				array: true,
			},
		});

		expect(entityDef.gqlEntityName).toBe('TestWarrior');
		expect(() => entityDef.buildResolvers()).not.toThrow();
	});

	it('should not crash when non-entity array field has generateFilter: true', () => {
		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			weaponTypes: {
				type: () => WeaponType,
				array: true,
				generateFilter: true,
			},
		});

		expect(() => {
			@GQLEntityClass(TestWarrior, fields)
			class TestWarriorEnumArrayFilterGQL extends GQLEntityBase {}
		}).not.toThrow();
	});

	it('should not crash when primitive array field has generateFilter: true', () => {
		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			tags: {
				type: () => String,
				array: true,
				generateFilter: true,
			},
		});

		expect(() => {
			@GQLEntityClass(TestWarrior, fields)
			class TestWarriorTagsFilterGQL extends GQLEntityBase {}
		}).not.toThrow();
	});

	it('should handle mixed entity and non-entity array fields with generateFilter', () => {
		@GQLEntityClass(TestWeapon, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
		})
		class TestWeaponGQL2 extends GQLEntityBase {}

		const fields = defineFields(TestWarrior, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			weapons: {
				type: () => TestWeaponGQL2,
				array: true,
				generateFilter: true,
			},
			tags: {
				type: () => String,
				array: true,
				generateFilter: true,
			},
			weaponTypes: {
				type: () => WeaponType,
				array: true,
				generateFilter: true,
			},
		});

		@GQLEntityClass(TestWarrior, fields)
		class TestWarriorMixedGQL extends GQLEntityBase {}

		expect(TestWarriorMixedGQL.gqlEntityName).toBe('TestWarrior');
		expect(TestWarriorMixedGQL.FilterInput).toBeDefined();
	});
});
