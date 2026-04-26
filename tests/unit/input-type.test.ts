import { beforeEach, describe, expect, it } from 'bun:test';
import {
	defineFields,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

class TestHobbit {
	id!: number;
	name!: string;
	age!: number;
	home?: string;
	ringId?: number;
}

class TestRing {
	id!: number;
	name!: string;
	power!: string;
}

enum HobbitMeal {
	Breakfast = 'BREAKFAST',
	SecondBreakfast = 'SECOND_BREAKFAST',
	Elevenses = 'ELEVENSES',
}

describe('Input Type Generation', () => {
	beforeEach(() => {
		setGlobalConfig({ gqlTypesSuffix: '' });
	});

	it('should generate Input static on decorated class', () => {
		@GQLEntityClass(TestHobbit, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			age: { type: () => String },
		})
		class TestHobbitGQL extends GQLEntityBase {}

		expect(TestHobbitGQL.Input).toBeDefined();
		expect(TestHobbitGQL.Input.name).toBe('TestHobbitInput');
	});

	it('should include only scalar fields in Input type', () => {
		@GQLEntityClass(TestRing, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			power: { type: () => String },
		})
		class TestRingGQL extends GQLEntityBase {}

		const inputInstance = new TestRingGQL.Input();
		expect(inputInstance).toBeDefined();
	});

	it('should exclude array relation fields from Input type', () => {
		@GQLEntityClass(TestRing, {
			id: { type: () => String },
			name: { type: () => String },
			power: { type: () => String },
		})
		class TestRingGQL2 extends GQLEntityBase {}

		@GQLEntityClass(TestHobbit, {
			id: { type: () => String },
			name: { type: () => String },
			age: { type: () => String },
			rings: {
				type: () => TestRingGQL2,
				array: true,
				relatedEntityName: () => 'TestRing',
				generateFilter: true,
			},
		})
		class TestHobbitWithRingsGQL extends GQLEntityBase {}

		expect(TestHobbitWithRingsGQL.Input).toBeDefined();
		expect(TestHobbitWithRingsGQL.Input.name).toBe('TestHobbitInput');
	});

	it('should exclude fields with excludeFromInput: true', () => {
		@GQLEntityClass(TestHobbit, {
			id: { type: () => String },
			name: { type: () => String },
			age: { type: () => String, excludeFromInput: true },
		})
		class TestHobbitExcludeGQL extends GQLEntityBase {}

		expect(TestHobbitExcludeGQL.Input).toBeDefined();
	});

	it('should exclude custom fields from Input type', () => {
		@GQLEntityClass(
			TestHobbit,
			{
				id: { type: () => String },
				name: { type: () => String },
			},
			{
				customFields: {
					computedTitle: {
						type: () => String,
						options: { nullable: true },
						resolve: () => 'The Hobbit',
						resolveDecorators: [],
					},
				},
			}
		)
		class TestHobbitCustomGQL extends GQLEntityBase {}

		expect(TestHobbitCustomGQL.Input).toBeDefined();
	});

	it('should include enum fields in Input type', () => {
		@GQLEntityClass(TestHobbit, {
			id: { type: () => String },
			name: { type: () => String },
			favoriteMeal: { type: () => HobbitMeal },
		})
		class TestHobbitEnumGQL extends GQLEntityBase {}

		expect(TestHobbitEnumGQL.Input).toBeDefined();
		expect(TestHobbitEnumGQL.Input.name).toBe('TestHobbitInput');
	});

	it('should use alias name in Input type', () => {
		@GQLEntityClass(TestHobbit, {
			id: { type: () => String },
			fullName: { type: () => String, alias: 'name' },
		})
		class TestHobbitAliasGQL extends GQLEntityBase {}

		expect(TestHobbitAliasGQL.Input).toBeDefined();
	});

	it('should generate Input type with createGQLEntity', async () => {
		const { createGQLEntity } = await import('../../src/entities/gql-entity');

		const entityDef = createGQLEntity(TestHobbit, {
			id: { type: () => String },
			name: { type: () => String },
			age: { type: () => String },
		});

		const resolverDef = entityDef.buildResolvers();

		expect(resolverDef.GQLEntityInput).toBeDefined();
		expect(resolverDef.GQLEntityInput.name).toBe('TestHobbitInput');
	});

	it('should generate Input type with createGQLTypes', async () => {
		const { createGQLTypes } = await import('../../src/entities/gql-entity');

		const result = createGQLTypes(TestRing, {
			id: { type: () => String },
			name: { type: () => String },
			power: { type: () => String },
		});

		expect(result.GQLEntityInput).toBeDefined();
		expect(result.GQLEntityInput.name).toBe('TestRingInput');
	});

	it('should respect gqlTypesSuffix in Input type name', () => {
		setGlobalConfig({ gqlTypesSuffix: 'V2' });

		class TestElf {
			id!: number;
			name!: string;
		}

		@GQLEntityClass(TestElf, {
			id: { type: () => String },
			name: { type: () => String },
		})
		class TestElfGQL extends GQLEntityBase {}

		expect(TestElfGQL.Input).toBeDefined();
		expect(TestElfGQL.Input.name).toBe('TestElfV2Input');

		setGlobalConfig({ gqlTypesSuffix: '' });
	});
});
