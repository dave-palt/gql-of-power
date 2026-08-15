/**
 * Tests for exposing `orStrategy` to GraphQL clients via the exported
 * `GQLOrStrategy` enum + `ensureOrStrategyRegistered()`.
 *
 * The library does NOT force the field into any input type — the user decides
 * which queries expose it by declaring an optional @Arg. These tests prove:
 * - the enum registers with type-graphql and appears in the schema as `OrStrategy`
 * - enum value names avoid the hyphen problem (UNION_ALL → 'union-all')
 * - a client query resolves UNION_ALL / OR to the raw strings the mapper compares
 * - the resolved value drops into pagination.orStrategy and changes the SQL
 */
import { describe, expect, it } from 'bun:test';
import { graphql, printSchema } from 'graphql';
import 'reflect-metadata';
import { Arg, buildSchema, Query, Resolver } from 'type-graphql';
import { setGlobalConfig } from '../../src';
import { createGQLTypes, ensureOrStrategyRegistered } from '../../src/entities/gql-entity';
import { GQLOrStrategy } from '../../src/types/sql-types';
import { Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

describe('GQLOrStrategy client exposure', () => {
	it('enum maps GraphQL-safe names to the raw strategy strings', () => {
		expect(GQLOrStrategy.UNION_ALL).toBe('union-all');
		expect(GQLOrStrategy.OR).toBe('or');
	});

	it('registers and appears in the schema SDL as OrStrategy', async () => {
		ensureOrStrategyRegistered();

		const PersonGQL = createGQLTypes(Person, {
			id: { type: () => Number, options: { nullable: false } },
			name: { type: () => String, options: { nullable: true }, generateFilter: true },
		});

		@Resolver(() => PersonGQL.GQLEntity)
		class PersonResolver {
			@Query(() => [PersonGQL.GQLEntity])
			persons(
				@Arg('orStrategy', () => GQLOrStrategy, { nullable: true })
				_orStrategy?: GQLOrStrategy
			) {
				return [];
			}
		}

		const schema = await buildSchema({ resolvers: [PersonResolver], validate: false });
		const sdl = printSchema(schema);

		expect(sdl).toContain('enum OrStrategy');
		// value names are GraphQL-safe; VALUES carry the hyphenated raw string
		expect(sdl).toContain('UNION_ALL');
		expect(sdl).toContain('OR');
	});

	it('client query resolves UNION_ALL/OR and the value changes generated SQL', async () => {
		ensureOrStrategyRegistered();

		const PersonGQL = createGQLTypes(Person, {
			id: { type: () => Number, options: { nullable: false } },
			name: { type: () => String, options: { nullable: true }, generateFilter: true },
			race: { type: () => String, options: { nullable: true }, generateFilter: true },
		});

		const received: (GQLOrStrategy | undefined)[] = [];

		@Resolver(() => PersonGQL.GQLEntity)
		class PersonResolver {
			@Query(() => [PersonGQL.GQLEntity])
			persons(
				@Arg('orStrategy', () => GQLOrStrategy, { nullable: true })
				orStrategy?: GQLOrStrategy
			) {
				received.push(orStrategy);
				return [];
			}
		}

		const schema = await buildSchema({ resolvers: [PersonResolver], validate: false });

		// Send both enum variants as a real client would (unquoted identifiers)
		const result = await graphql({
			schema,
			source: `
				query {
					a: persons(orStrategy: OR) { id }
					b: persons(orStrategy: UNION_ALL) { id }
					c: persons { id }
				}
			`,
		});
		expect(result.errors).toBeUndefined();
		expect(received).toEqual([GQLOrStrategy.OR, GQLOrStrategy.UNION_ALL, undefined]);

		// The resolved value drops straight into pagination.orStrategy
		const { GQLtoSQLMapper } = await import('../../src/queries/gql-to-sql-mapper');
		const mapper = new GQLtoSQLMapper(createMockMetadataProvider());
		const filter = { _or: [{ name_eq: 'Frodo' }, { race_eq: 'Elf' }] };
		const build = (orStrategy?: GQLOrStrategy) =>
			mapper
				.buildQueryAndBindingsFor({
					fields: { id: {}, name: {}, race: {} },
					entity: Person,
					customFields: {},
					filter: filter as any,
					pagination: { orStrategy },
				})
				.querySQL.toLowerCase();

		expect(build(received[0])).not.toContain('union all'); // OR
		expect(build(received[1])).toContain('union all'); // UNION_ALL
	});
});
