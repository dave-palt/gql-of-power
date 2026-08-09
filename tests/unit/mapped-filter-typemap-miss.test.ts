import { describe, expect, it } from 'bun:test';
import { printSchema } from 'graphql';
import 'reflect-metadata';
import { Arg, buildSchema, Query, Resolver } from 'type-graphql';

import { setGlobalConfig } from '../../src';
import { createGQLEntity } from '../../src/entities/gql-entity';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

// Unique entity classes to avoid TypeMap pollution from other test files.
// Using shared fixtures (Author/Book) would make this test pass/fail depending
// on whether other tests registered their FilterInputs first.
class UniqueWeapon {
	id!: number;
	damage!: number;
}
class UniqueHero {
	id!: number;
	name!: string;
}

/**
 * Reproduces the TypeMap-miss bug: when a mapping custom field references an entity
 * whose FilterInput was never registered (buildResolvers() not called), the filter
 * silently fell back to the parent entity's FilterInput instead of erroring.
 *
 * After the fix: it throws a clear error naming the missing type.
 */
describe('mapped custom field filter — TypeMap miss fallback', () => {
	it('throws when referenced entity FilterInput is not registered (was: silent Author fallback)', async () => {
		// Weapon: create entity only, do NOT build resolvers → WeaponFilterInput never registered
		const WeaponEntity = createGQLEntity(UniqueWeapon, {
			id: { type: () => Number, options: { nullable: false } },
			damage: { type: () => String, options: { nullable: true }, generateFilter: true },
		});

		const HeroEntity = createGQLEntity(
			UniqueHero,
			{
				id: { type: () => Number, options: { nullable: false } },
				name: { type: () => String, options: { nullable: true }, generateFilter: true },
			},
			{
				customFields: {
					weapon: {
						type: () => WeaponEntity.GQLEntity,
						options: { nullable: true },
						generateFilter: true,
						mapping: {
							refEntity: UniqueWeapon,
							refFields: 'id',
							fields: 'id',
						},
					},
				} as any,
			}
		);

		const heroResolvers = HeroEntity.buildResolvers();

		@Resolver(() => HeroEntity.GQLEntity)
		class HeroResolver {
			@Query(() => [HeroEntity.GQLEntity])
			heroes(
				@Arg('filter', () => heroResolvers.GQLEntityFilterInput, { nullable: true })
				_filter?: any
			) {
				return [];
			}
		}

		// After the fix: schema build throws with a clear error,
		// not the silent wrong-typed filter that used to happen.
		await expect(
			buildSchema({
				resolvers: [HeroResolver, heroResolvers.FieldsResolver],
				validate: false,
			})
		).rejects.toThrow(/UniqueWeaponFilterInput.*is not registered/);
	});
});
