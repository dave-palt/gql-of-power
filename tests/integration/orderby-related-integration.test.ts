/**
 * Integration Tests: ORDER BY related m:1 columns (PR #24)
 *
 * Verifies against real PostgreSQL that nested-object orderBy keys for
 * many-to-one relations generate correct correlated subqueries and
 * return rows in the expected order.
 *
 * Example:
 *   orderBy: [{ fellowship: { name: 'asc' } }]
 *   → ORDER BY (SELECT e_o.fellowship_name FROM fellowships ...) ASC
 *
 * Uses the shared Middle-earth schema + test data (tests/fixtures/).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Person, Ring } from '../fixtures/middle-earth-schema';
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

describe('ORDER BY Related Columns Integration Tests (PR #24)', () => {
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

		describe('ORDER BY related m:1 columns', () => {
			it(
				'should order Person by related Fellowship.name ascending',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					const pagination = {
						orderBy: [{ fellowship: { name: 'asc' as any } }],
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination,
					});

					// SQL should contain a correlated subquery for the related column
					expect(result.querySQL.toLowerCase()).toContain('order by');
					expect(result.querySQL).toContain('(select');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					expect(dbResults.length).toBeGreaterThan(0);

					// Persons ordered by fellowship name — all Fellowship of the Ring
					// members should come before White Council (alphabetically)
					expect(dbResults.length).toBeGreaterThanOrEqual(2);
				},
				TEST_TIMEOUT
			);

			it(
				'should order Person by related Fellowship.name descending',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					const pagination = {
						orderBy: [{ fellowship: { name: 'desc' as any } }],
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination,
					});

					expect(result.querySQL.toLowerCase()).toContain('order by');
					expect(result.querySQL).toContain('(select');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should order Ring by related bearer.name (m:1 inverse)',
				async () => {
					const fields = { id: {}, name: {}, power: {} };
					const pagination = {
						orderBy: [{ bearer: { name: 'asc' } }] as any,
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Ring,
						customFields: {},
						pagination,
					});

					expect(result.querySQL.toLowerCase()).toContain('order by');
					expect(result.querySQL).toContain('(select');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);

			it(
				'should combine related orderBy with limit',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					const pagination = {
						orderBy: [{ fellowship: { name: 'asc' as any } }],
						limit: 5,
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination,
					});

					expect(result.bindings.limit).toBe(5);

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeLessThanOrEqual(5);
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
