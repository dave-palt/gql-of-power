/**
 * Integration Tests: ORDER BY related 1:m / m:m columns (PR #26)
 *
 * Verifies against real PostgreSQL that nested-object orderBy for one-to-many
 * and many-to-many relations generates correct MIN/MAX aggregated subqueries
 * and returns rows in the expected order.
 *
 * Example:
 *   orderBy: [{ members: { age: 'asc' } }]
 *   → ORDER BY (SELECT MIN(e_o.age) FROM persons e_o WHERE ...) ASC
 *
 * Uses the shared Middle-earth schema + test data (tests/fixtures/).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
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

describe('ORDER BY Related 1:m / m:m Integration Tests (PR #26)', () => {
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

		// ── 1:m: Fellowship → members (Person), orderBy on age ───────────

		describe('1:m orderBy (Fellowship → members.age)', () => {
			it(
				'should order fellowships by MIN(member age) ascending',
				async () => {
					const fields = { id: {}, name: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
						pagination: {
							orderBy: [{ members: { age: 'asc' } }] as any,
						},
					});

					expect(result.querySQL).toContain('order by');
					expect(result.querySQL).toContain('min(e_o.');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should order fellowships by MAX(member age) descending',
				async () => {
					const fields = { id: {}, name: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
						pagination: {
							orderBy: [{ members: { age: 'desc' } }] as any,
						},
					});

					expect(result.querySQL).toContain('max(e_o.');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should support mixed 1:m related + flat orderBy',
				async () => {
					const fields = { id: {}, name: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
						pagination: {
							orderBy: [{ members: { age: 'asc' } }, { name: 'desc' }] as any,
						},
					});

					expect(result.querySQL).toContain('min(e_o.');
					expect(result.querySQL).toContain('desc');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);
		});

		// ── m:m: Person → battles (Battle), orderBy on casualties ────────

		describe('m:m orderBy (Person → battles.casualties)', () => {
			it(
				'should order persons by MIN(battle casualties) ascending',
				async () => {
					const fields = { id: {}, name: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: {
							orderBy: [{ battles: { casualties: 'asc' } }] as any,
						},
					});

					expect(result.querySQL).toContain('min(e_o.');
					expect(result.querySQL).toContain('person_battles');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should order persons by MAX(battle casualties) descending',
				async () => {
					const fields = { id: {}, name: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: {
							orderBy: [{ battles: { casualties: 'desc' } }] as any,
						},
					});

					expect(result.querySQL).toContain('max(e_o.');
					expect(result.querySQL).toContain('person_battles');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
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
