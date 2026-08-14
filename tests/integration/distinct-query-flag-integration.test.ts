/**
 * Integration Tests: DISTINCT query flag (PR #27)
 *
 * Verifies against real PostgreSQL that:
 *   - Root-level pagination.distinct emits SELECT DISTINCT and deduplicates rows
 *   - Nested distinct (via args.pagination on relation fields) deduplicates
 *     inside the correlated subquery
 *   - Both can be used simultaneously
 *   - DISTINCT works alongside _or (UNION ALL path) and limit/orderBy
 *
 * Uses the shared Middle-earth schema + test data (tests/fixtures/).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
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

describe('DISTINCT Query Flag Integration Tests (PR #27)', () => {
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

		// ── Root-level DISTINCT ────────────────────────────────────────────

		describe('root-level DISTINCT', () => {
			it(
				'should emit SELECT DISTINCT and return deduplicated rows',
				async () => {
					const fields = { id: {}, name: {}, race: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: { distinct: true },
					});

					expect(result.querySQL).toMatch(/^select distinct /i);

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					expect(dbResults.length).toBeGreaterThan(0);

					// Verify no duplicate IDs (distinct should prevent dups)
					const ids = dbResults.map((r: any) => r.id);
					const uniqueIds = [...new Set(ids)];
					expect(ids.length).toBe(uniqueIds.length);
				},
				TEST_TIMEOUT
			);

			it(
				'should NOT emit distinct when pagination.distinct is omitted',
				async () => {
					const fields = { id: {}, name: {}, race: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: {},
					});

					expect(result.querySQL).not.toMatch(/^select distinct /i);
				},
				TEST_TIMEOUT
			);
		});

		// ── DISTINCT with UNION ALL ────────────────────────────────────────

		describe('DISTINCT with _or (UNION ALL path)', () => {
			it(
				'should emit SELECT DISTINCT on the outer query of a UNION ALL',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					const filter = {
						_or: [{ race: 'Hobbit' }, { race: 'Elf' }],
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
						pagination: { distinct: true },
					});

					expect(result.querySQL).toMatch(/^select distinct /i);
					expect(result.querySQL.toLowerCase()).toContain('union all');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);

					// All results should be Hobbit or Elf
					dbResults.forEach((row: any) => {
						expect(['Hobbit', 'Elf']).toContain(row.race);
					});
				},
				TEST_TIMEOUT
			);
		});

		// ── Root DISTINCT with limit + orderBy ─────────────────────────────

		describe('DISTINCT with limit and orderBy', () => {
			it(
				'should apply DISTINCT alongside limit and orderBy',
				async () => {
					const fields = { id: {}, name: {}, race: {} };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination: {
							distinct: true,
							limit: 5,
							orderBy: [{ name: 'asc' as any }],
						},
					});

					expect(result.querySQL).toMatch(/^select distinct /i);
					expect(result.querySQL.toLowerCase()).toContain('order by');
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

		// ── Nested DISTINCT ────────────────────────────────────────────────

		describe('nested DISTINCT on 1:m relation', () => {
			it(
				'should emit SELECT DISTINCT inside nested members subquery',
				async () => {
					const fields = {
						id: {},
						name: {},
						members: {
							args: {
								pagination: { distinct: true },
							},
							fieldsByTypeName: {
								Person: {
									id: {},
									name: {},
									race: {},
								},
							},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
					});

					// The nested members subquery should contain 'select distinct'
					expect(result.querySQL).toMatch(/select distinct .*from "persons"/i);
					// The outer query should NOT have distinct (only requested nested)
					expect(result.querySQL).not.toMatch(/^select distinct /i);

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);

			it(
				'should support root and nested distinct simultaneously',
				async () => {
					const fields = {
						id: {},
						name: {},
						members: {
							args: {
								pagination: { distinct: true },
							},
							fieldsByTypeName: {
								Person: {
									id: {},
									name: {},
								},
							},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
						pagination: { distinct: true },
					});

					expect(result.querySQL).toMatch(/^select distinct /i);
					expect(result.querySQL).toMatch(/select distinct .*from "persons"/i);

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
