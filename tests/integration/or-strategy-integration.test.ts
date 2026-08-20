/**
 * PostgreSQL integration tests for per-branch orStrategy (PR #60).
 *
 * Unit suites assert SQL SHAPE; these assert REAL ROWS: the three surfaces of
 * the feature executed against live postgres and cross-checked for semantic
 * equivalence — same rows regardless of strategy, and the explicit override
 * really winning over pagination at both levels.
 *
 * Uses Person (fellowship m:1, battles m:m) — entities the integration
 * DatabaseMetadataProvider has metadata for.
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Person } from '../fixtures/middle-earth-schema';
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

describe('Per-branch orStrategy Integration Tests (PR #60)', () => {
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

		const run = async (built: { querySQL: string; bindings: any }) =>
			(await metadataProvider.executeQuery(
				k.raw(built.querySQL, built.bindings).toString()
			)) as any[];

		const toIdSet = (rows: any[]) => new Set(rows.map((r: any) => r.id));

		it(
			'root pagination.orStrategy = "or": same rows as union-all default, different SQL',
			async () => {
				const build = (pagination: any) =>
					mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {} },
						entity: Person,
						customFields: {},
						filter: {
							_or: [{ name_eq: 'Frodo Baggins' }, { race_eq: 'Elf' }],
						} as any,
						pagination,
					});

				const builtOr = build({ orStrategy: 'or' });
				const builtUnion = build(undefined);

				expect(builtOr.querySQL.toLowerCase()).not.toContain('union all');
				expect(builtUnion.querySQL.toLowerCase()).toContain('union all');

				const orRows = await run(builtOr);
				const unionRows = await run(builtUnion);
				expect(toIdSet(orRows).size).toBeGreaterThan(0);
				expect(toIdSet(orRows)).toEqual(toIdSet(unionRows));
			},
			TEST_TIMEOUT
		);

		it(
			'child pagination.orStrategy = "or" on relation field: same rows as union-all default',
			async () => {
				// battles FIELD (selection) carries its own pagination+filter; the
				// _or over battle scalars is resolved in that branch's sub-lateral
				const build = (childPagination: any) =>
					mapper.buildQueryAndBindingsFor({
						fields: {
							id: {},
							name: {},
							battles: {
								fieldsByTypeName: {},
								args: {
									filter: {
										_or: [{ outcome_eq: 'Victory' }, { casualties_gt: 6000 }],
									},
									pagination: childPagination,
								},
							},
						},
						entity: Person,
						customFields: {},
					});

				const builtOr = build({ orStrategy: 'or' });
				const builtUnion = build(undefined);

				const orRows = await run(builtOr);
				const unionRows = await run(builtUnion);
				expect(orRows.length).toBeGreaterThan(0);
				expect(toIdSet(orRows)).toEqual(toIdSet(unionRows));
			},
			TEST_TIMEOUT
		);

		it(
			'explicit orStrategy argument overrides root pagination.orStrategy (same rows)',
			async () => {
				const base: any = {
					fields: { id: {}, name: {} },
					entity: Person,
					customFields: {},
					filter: {
						_or: [{ name_eq: 'Frodo Baggins' }, { race_eq: 'Elf' }],
					},
					pagination: { orStrategy: 'or' },
				};
				const builtRootOr = mapper.buildQueryAndBindingsFor(base);
				const builtExplicit = mapper.buildQueryAndBindingsFor({
					...base,
					orStrategy: 'union-all',
				});

				expect(builtRootOr.querySQL.toLowerCase()).not.toContain('union all');
				expect(builtExplicit.querySQL.toLowerCase()).toContain('union all');

				const rootOrRows = await run(builtRootOr);
				const explicitRows = await run(builtExplicit);
				expect(toIdSet(rootOrRows)).toEqual(toIdSet(explicitRows));
				// both strategies find Frodo + the Elves
				expect(rootOrRows.length).toBeGreaterThanOrEqual(2);
			},
			TEST_TIMEOUT
		);

		it(
			'explicit orStrategy argument overrides child pagination.orStrategy (same rows)',
			async () => {
				const base: any = {
					fields: {
						id: {},
						name: {},
						battles: {
							fieldsByTypeName: {},
							args: {
								filter: {
									_or: [{ outcome_eq: 'Victory' }, { casualties_gt: 6000 }],
								},
								pagination: { orStrategy: 'or' },
							},
						},
					},
					entity: Person,
					customFields: {},
				};
				const builtChildOr = mapper.buildQueryAndBindingsFor(base);
				const builtExplicit = mapper.buildQueryAndBindingsFor({
					...base,
					orStrategy: 'union-all',
				});

				const childOrRows = await run(builtChildOr);
				const explicitRows = await run(builtExplicit);
				expect(childOrRows.length).toBeGreaterThan(0);
				expect(toIdSet(explicitRows)).toEqual(toIdSet(childOrRows));
			},
			TEST_TIMEOUT
		);

		it(
			'child filter with relation-key _or: per-branch strategy, equivalent rows',
			async () => {
				// Person filtered BY battles via filter (EXISTS path) — strategy
				// shapes the EXISTS subquery; per-branch value must equal default rows
				const build = (pagination: any) =>
					mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {} },
						entity: Person,
						customFields: {},
						filter: {
							battles: {
								_or: [{ name_eq: "Battle of Helm's Deep" }, { outcome_eq: 'Defeat' }],
							},
						} as any,
						pagination,
					});

				const builtOr = build({ orStrategy: 'or' });
				const builtUnion = build(undefined);

				expect(builtOr.querySQL.toLowerCase()).not.toContain('union all');
				expect(builtUnion.querySQL.toLowerCase()).toContain('union all');

				const orRows = await run(builtOr);
				const unionRows = await run(builtUnion);
				expect(toIdSet(orRows).size).toBeGreaterThan(0);
				expect(toIdSet(orRows)).toEqual(toIdSet(unionRows));
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
