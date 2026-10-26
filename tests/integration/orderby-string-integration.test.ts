/**
 * Integration Tests: string-form orderBy (issue #68)
 *
 * Verifies against real PostgreSQL that orderBy entries expressed as plain
 * strings — "field", "field asc|desc", "relation.field", "relation.field
 * asc|desc" — are normalized into the nested-object form and generate the
 * same SQL and the same rows as the programmatic object API, and that the
 * string form is accepted through a real type-graphql schema (SDL boundary).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { graphql, GraphQLResolveInfo } from 'graphql';
import { join } from 'path';
import knex from 'knex';
import 'reflect-metadata';
import { Arg, Info, Query, Resolver, buildSchema } from 'type-graphql';
import { GQLQueryManager } from '../../src/query-manager';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { createGQLTypes } from '../../src/entities/gql-entity';
import { FieldSettings, RelatedFieldSettings } from '../../src/types';
import { Fellowship, Person } from '../fixtures/middle-earth-schema';
import { DatabaseMetadataProvider } from '../fixtures/database-metadata-provider';
import { AllSampleData } from '../fixtures/test-data';
import { getTestDBConfig } from '../fixtures/test-db-config';
import '../setup';

const DB_CONFIG = getTestDBConfig();
const TEST_TIMEOUT = 30000;
const k = knex({ client: 'pg' });

const filePath = join(__dirname, '../../', 'tests/fixtures/database-schema.sql');
const schemaFile = Bun.file(filePath);
const exists = await schemaFile.exists();
const describeOrSkip = exists ? describe : describe.skip;

describe('ORDER BY String Form Integration Tests (issue #68)', () => {
	describeOrSkip('PostgreSQL', () => {
		let sql: SQL;
		let metadataProvider: DatabaseMetadataProvider;
		let mapper: GQLtoSQLMapper;

		beforeAll(async () => {
			try {
				const adminSql = new SQL(DB_CONFIG.maintenanceUrl);
				const safeDbName = DB_CONFIG.database.replace(/[^a-zA-Z0-9_]/g, '');
				await adminSql.query(`CREATE DATABASE ${safeDbName};`);
				await adminSql.close();
			} catch {
				// database already exists (CI)
			}
			sql = new SQL(DB_CONFIG.url);
			await sql.file(filePath);
			metadataProvider = new DatabaseMetadataProvider(sql);
			mapper = new GQLtoSQLMapper(metadataProvider, { namedParameterPrefix: ':' });
		});

		beforeEach(async () => {
			await insertTestData();
		});

		afterEach(async () => {
			const truncateOrder = [
				'person_battles',
				'army_battles',
				'book_characters',
				'book_genres',
				'quest_locations',
				'battles',
				'armies',
				'books',
				'rings',
				'persons',
				'weapons',
				'artifacts',
				'fellowships',
				'quests',
				'locations',
				'regions',
				'authors',
				'genres',
			];
			for (const table of truncateOrder) {
				try {
					await sql`TRUNCATE TABLE ${sql.unsafe(table)} RESTART IDENTITY CASCADE`;
				} catch {}
			}
		});

		afterAll(async () => {
			if (metadataProvider) await metadataProvider.close();
			if (sql) await sql.end();
		});

		it(
			'string related-field orderBy generates IDENTICAL SQL to the nested-object form',
			() => {
				const fields = { id: {}, name: {}, race: {} };
				const viaString = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {},
					pagination: { orderBy: ['fellowship.name desc'] },
				});
				const viaObject = mapper.buildQueryAndBindingsFor({
					fields,
					entity: Person,
					customFields: {},
					pagination: { orderBy: [{ fellowship: { name: 'desc' as any } }] },
				});
				expect(viaString.querySQL).toBe(viaObject.querySQL);
				expect(viaString.querySQL.toLowerCase()).toContain('order by');
				expect(viaString.querySQL).toContain('(select');
			},
			TEST_TIMEOUT
		);

		it(
			'string related-field orderBy returns the same rows in the same order as the object form',
			async () => {
				const fields = { id: {}, name: {}, race: {} };
				const build = (orderBy: any) =>
					mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: { orderBy },
					});
				const viaString = build(['fellowship.name desc']);
				const viaObject = build([{ fellowship: { name: 'desc' as any } }]);

				const rowsString = await metadataProvider.executeQuery(
					k.raw(viaString.querySQL, viaString.bindings).toString()
				);
				const rowsObject = await metadataProvider.executeQuery(
					k.raw(viaObject.querySQL, viaObject.bindings).toString()
				);
				expect(rowsString).toEqual(rowsObject);
				expect(rowsString.length).toBeGreaterThan(0);
			},
			TEST_TIMEOUT
		);

		it(
			'string flat orderBy orders by the mapped column (name -> person_name)',
			async () => {
				const result = mapper.buildQueryAndBindingsFor({
					fields: { id: {}, name: {} },
					entity: Person,
					customFields: {},
					pagination: { orderBy: ['name desc'] },
				});
				const rows = await metadataProvider.executeQuery(
					k.raw(result.querySQL, result.bindings).toString()
				);
				const names: string[] = rows.map((r: any) => r.name);
				expect(names.length).toBeGreaterThan(1);
				expect([...names].sort().reverse()).toEqual(names);
			},
			TEST_TIMEOUT
		);

		it(
			'mixed string/object orderBy arrays build and execute',
			async () => {
				const result = mapper.buildQueryAndBindingsFor({
					fields: { id: {}, name: {}, race: {} },
					entity: Person,
					customFields: {},
					pagination: { orderBy: [{ name: 'asc' as any }, 'fellowship.name desc'] },
				});
				const rows = await metadataProvider.executeQuery(
					k.raw(result.querySQL, result.bindings).toString()
				);
				expect(Array.isArray(rows)).toBe(true);
				expect(rows.length).toBeGreaterThan(0);
			},
			TEST_TIMEOUT
		);

		it(
			'multi-hop string orderBy fails with the dedicated error',
			() => {
				expect(() =>
					mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {} },
						entity: Person,
						customFields: {},
						pagination: { orderBy: ['fellowship.quest.name'] },
					})
				).toThrow('one relation hop');
			},
			TEST_TIMEOUT
		);

		it(
			'string orderBy with an unknown related field fails loudly',
			() => {
				expect(() =>
					mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {} },
						entity: Person,
						customFields: {},
						pagination: { orderBy: ['fellowship.bogus'] },
					})
				).toThrow('cannot be resolved');
			},
			TEST_TIMEOUT
		);

		it(
			'string orderBy is accepted through a real type-graphql schema (SDL boundary)',
			async () => {
				// Minimal GQL types for Person + Fellowship (id/name/fellowship only)
				const FellowshipFields: Partial<Record<string, RelatedFieldSettings<any>>> = {
					id: { type: () => Number, options: { nullable: false }, generateFilter: true },
					name: { type: () => String, options: { nullable: true }, generateFilter: true },
				};
				const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields as any);

				const PersonFieldsSDL: Partial<
					Record<keyof Person, FieldSettings | RelatedFieldSettings<any>>
				> = {
					id: { type: () => Number, options: { nullable: false }, generateFilter: true },
					name: { type: () => String, options: { nullable: true }, generateFilter: true },
					fellowship: {
						type: () => FellowshipGQL.GQLEntity,
						options: { nullable: true },
						generateFilter: true,
						relatedEntityName: () => 'Fellowship',
						getFilterType: () => Number,
					},
				};
				const PersonGQLSDL = createGQLTypes(Person, PersonFieldsSDL as any);

				const queryManager = new GQLQueryManager();
				const sdlMetadataProvider = metadataProvider;

				@Resolver(() => PersonGQLSDL.GQLEntity || Object)
				class PersonSDLResolver extends PersonGQLSDL.FieldsResolver {
					@Query(() => [PersonGQLSDL.GQLEntity])
					async sdlPersons(
						@Info() info: GraphQLResolveInfo,
						@Arg('pagination', () => PersonGQLSDL.GQLEntityPaginationInputField || Object, {
							nullable: true,
						})
						pagination?: any
					) {
						return await queryManager.getQueryResultsForInfo<any, Person>(
							sdlMetadataProvider,
							Person,
							info,
							undefined,
							pagination
						);
					}
				}

				const schema = await buildSchema({ resolvers: [PersonSDLResolver] });

				// String orderBy through GraphQL variables — this is the gap issue #68 describes:
				// before the fix, SDL validation rejected anything but flat { field: ASC } objects.
				const result = await graphql({
					schema,
					source: `query ($pagination: PersonPaginationInput) {
						sdlPersons(pagination: $pagination) { name fellowship { name } }
					}`,
					variableValues: { pagination: { orderBy: ['fellowship.name desc'] } },
				});
				expect(result.errors).toBeUndefined();
				const rows = result.data!.sdlPersons as any[];
				expect(rows.length).toBeGreaterThan(0);
				// Order by fellowship name desc; PostgreSQL puts NULLs first on DESC.
				const names = rows.map((p: any) => p.fellowship?.name ?? null);
				const nonNull = names.filter((n: any) => n !== null) as string[];
				const nullCount = names.length - nonNull.length;
				expect(names.slice(0, nullCount)).toEqual(Array(nullCount).fill(null));
				expect(nonNull).toEqual([...nonNull].sort().reverse());

				// Inline string literal form (no variables) also passes validation
				const inline = await graphql({
					schema,
					source: `{ sdlPersons(pagination: { orderBy: ["name desc"] }) { name } }`,
				});
				expect(inline.errors).toBeUndefined();

				// Invalid grammar is rejected at the GraphQL boundary with a clear message
				const bad = await graphql({
					schema,
					source: `query ($pagination: PersonPaginationInput) {
						sdlPersons(pagination: $pagination) { name }
					}`,
					variableValues: { pagination: { orderBy: ['fellowship.quest.name'] } },
				});
				expect(bad.errors).toBeDefined();
				expect(bad.errors![0].message).toContain('one relation hop');
			},
			TEST_TIMEOUT
		);

		async function insertTestData(): Promise<void> {
			const insertOrder = [
				{ table: 'regions', data: AllSampleData.regions || [] },
				{ table: 'quests', data: AllSampleData.quests || [] },
				{ table: 'fellowships', data: AllSampleData.fellowships || [] },
				{ table: 'weapons', data: AllSampleData.weapons || [] },
				{ table: 'artifacts', data: AllSampleData.artifacts || [] },
				{ table: 'persons', data: AllSampleData.persons || [] },
				{ table: 'rings', data: AllSampleData.rings || [] },
				{ table: 'authors', data: AllSampleData.authors || [] },
				{ table: 'genres', data: AllSampleData.genres || [] },
				{ table: 'books', data: AllSampleData.books || [] },
				{ table: 'locations', data: AllSampleData.locations || [] },
				{ table: 'battles', data: AllSampleData.battles || [] },
				{ table: 'armies', data: AllSampleData.armies || [] },
				{ table: 'person_battles', data: AllSampleData.person_battles || [] },
				{ table: 'army_battles', data: AllSampleData.army_battles || [] },
				{ table: 'book_characters', data: AllSampleData.book_characters || [] },
				{ table: 'book_genres', data: AllSampleData.book_genres || [] },
				{ table: 'quest_locations', data: AllSampleData.quest_locations || [] },
			];

			for (const { table, data } of insertOrder) {
				if (data.length > 0) {
					await sql`INSERT INTO ${sql.unsafe(table)} ${sql(data)}`;
				}
			}
		}
	});
});
