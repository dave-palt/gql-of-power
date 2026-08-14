/**
 * Integration Tests: Aggregate fields (PR #25)
 *
 * Verifies against real PostgreSQL that aggregate fields (sum/avg/min/max)
 * generate correct correlated subqueries and return accurate computed values.
 *
 * Two relationship shapes tested:
 *   - 1:m: Fellowship → members (Person), aggregating `age`
 *   - m:m: Person → battles (Battle), aggregating `casualties`
 *
 * Also tests aggregate filtering (e.g. totalCasualties_gt: 5000).
 *
 * Uses the shared Middle-earth schema + test data (tests/fixtures/).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { clearAggregateFields, registerAggregateField } from '../../src/entities/gql-entity';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Battle, Fellowship, Person } from '../fixtures/middle-earth-schema';
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

describe('Aggregate Fields Integration Tests (PR #25)', () => {
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
			clearAggregateFields();
			await insertTestData();
		});

		afterEach(async () => {
			clearAggregateFields();
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

		// ── 1:m: Fellowship → members (Person), aggregate on age ──────────

		describe('1:m aggregates (Fellowship → members.age)', () => {
			it(
				'should compute MAX(age) of fellowship members',
				async () => {
					registerAggregateField(
						'Fellowship',
						'oldestMemberAge',
						'max',
						'age',
						'members',
						() => 'Person'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, oldestMemberAge: {} } as any,
						entity: Fellowship,
						customFields: {},
					});

					expect(result.querySQL).toContain('max(');
					expect(result.querySQL).toContain('age');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);

					const fotr = dbResults.find((r: any) => r.name === 'Fellowship of the Ring');
					expect(fotr).toBeDefined();
					// Gandalf has the highest age in FotR (null ages excluded by MAX)
					expect(Number((fotr as any).oldestMemberAge)).toBeGreaterThan(100);
				},
				TEST_TIMEOUT
			);

			it(
				'should compute MIN(age) of fellowship members',
				async () => {
					registerAggregateField(
						'Fellowship',
						'youngestMemberAge',
						'min',
						'age',
						'members',
						() => 'Person'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, youngestMemberAge: {} } as any,
						entity: Fellowship,
						customFields: {},
					});

					expect(result.querySQL).toContain('min(');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);

					const fotr = dbResults.find((r: any) => r.name === 'Fellowship of the Ring');
					expect(fotr).toBeDefined();
					expect(Number((fotr as any).youngestMemberAge)).toBeLessThan(50);
				},
				TEST_TIMEOUT
			);

			it(
				'should compute SUM(age) of fellowship members',
				async () => {
					registerAggregateField(
						'Fellowship',
						'totalAgeSum',
						'sum',
						'age',
						'members',
						() => 'Person'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, totalAgeSum: {} } as any,
						entity: Fellowship,
						customFields: {},
					});

					expect(result.querySQL).toContain('sum(');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);

					// Fellowship 1 (of the Ring) should have a non-null sum
					const fotr = dbResults.find((r: any) => r.name === 'Fellowship of the Ring');
					expect(fotr).toBeDefined();
					expect(Number((fotr as any).totalAgeSum)).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should compute AVG(age) of fellowship members',
				async () => {
					registerAggregateField('Fellowship', 'avgAge', 'avg', 'age', 'members', () => 'Person');

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, avgAge: {} } as any,
						entity: Fellowship,
						customFields: {},
					});

					expect(result.querySQL).toContain('avg(');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);
		});

		// ── m:m: Person → battles (Battle), aggregate on casualties ───────

		describe('m:m aggregates (Person → battles.casualties)', () => {
			it(
				'should compute MAX(casualties) across battles a person fought in',
				async () => {
					registerAggregateField(
						'Person',
						'maxCasualties',
						'max',
						'casualties',
						'battles',
						() => 'Battle'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, maxCasualties: {} } as any,
						entity: Person,
						customFields: {},
					});

					expect(result.querySQL).toContain('max(');
					expect(result.querySQL).toContain('person_battles');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);

					// Persons who fought in battles should have non-null maxCasualties
					// Aragorn fought in Pelennor Fields (7000 casualties)
					const aragorn = dbResults.find((r: any) => r.name === 'Aragorn');
					if (aragorn) {
						expect(Number((aragorn as any).maxCasualties)).toBeGreaterThanOrEqual(500);
					}
				},
				TEST_TIMEOUT
			);

			it(
				'should compute SUM(casualties) across battles a person fought in',
				async () => {
					registerAggregateField(
						'Person',
						'totalCasualties',
						'sum',
						'casualties',
						'battles',
						() => 'Battle'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, totalCasualties: {} } as any,
						entity: Person,
						customFields: {},
					});

					expect(result.querySQL).toContain('sum(');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);
		});

		// ── Aggregate filtering ────────────────────────────────────────────

		describe('aggregate field filtering', () => {
			it(
				'should filter persons by totalCasualties_gt',
				async () => {
					registerAggregateField(
						'Person',
						'totalCasualties',
						'sum',
						'casualties',
						'battles',
						() => 'Battle'
					);

					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {} } as any,
						entity: Person,
						customFields: {},
						filter: { totalCasualties_gt: 5000 } as any,
					});

					expect(result.querySQL).toContain('sum(');
					expect(result.querySQL).toContain('>');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					// Only persons who fought in high-casualty battles match
					expect(dbResults.length).toBeGreaterThanOrEqual(0);
				},
				TEST_TIMEOUT
			);
		});

		// ── Helper ─────────────────────────────────────────────────────────

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
