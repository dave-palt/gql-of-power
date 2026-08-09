/**
 * Integration Tests: _not filter operator + new comparison operators (PR #23)
 *
 * Verifies against real PostgreSQL that the following produce correct SQL
 * and return the expected rows:
 *   - _not: { ... }  — negates the conjunction of filter conditions
 *   - _nlike / _nilike  — negated LIKE / ILIKE
 *   - _startsWith / _istartsWith / _endsWith / _iendsWith
 *   - _nre  — negated regex match
 *   - _nbetween — NOT BETWEEN range
 *   - _is_null — IS NULL / IS NOT NULL (bool param)
 *
 * Uses the shared Middle-earth schema + test data (tests/fixtures/).
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import knex from 'knex';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Person, Ring, Author, Book, Genre } from '../fixtures/middle-earth-schema';
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

describe('Filter Operators Integration Tests (PR #23)', () => {
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

		// ── _not operator ──────────────────────────────────────────────────

		describe('_not negation operator', () => {
			it(
				'should negate a single filter condition',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					const filter = {
						_not: [{ race: 'Hobbit' }],
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					expect(dbResults.length).toBeGreaterThan(0);
					// No row should be a Hobbit
					dbResults.forEach((row: any) => {
						expect(row.race).not.toBe('Hobbit');
					});
				},
				TEST_TIMEOUT
			);

			it(
				'should negate a conjunction of multiple conditions',
				async () => {
					const fields = { id: {}, name: {}, race: {} };
					// NOT (race = 'Hobbit' AND name = 'Frodo Baggins')
					// Should return everyone except Frodo (including other Hobbits)
					const filter = {
						_not: [{ race: 'Hobbit' }, { name: 'Frodo Baggins' }],
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					// Frodo should NOT be in results
					const frodo = dbResults.find((r: any) => r.name === 'Frodo Baggins');
					expect(frodo).toBeUndefined();
					// But other Hobbits should be present (negation of AND is not AND of negations)
					const otherHobbits = dbResults.filter((r: any) => r.race === 'Hobbit');
					expect(otherHobbits.length).toBeGreaterThan(0);
				},
				TEST_TIMEOUT
			);
		});

		// ── String operators ───────────────────────────────────────────────

		describe('string comparison operators', () => {
			it(
				'should filter with _startsWith',
				async () => {
					const fields = { id: {}, name: {} };
					const filter = { name_startsWith: 'Frodo' };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBe(1);
					expect((dbResults[0] as any).name).toBe('Frodo Baggins');
				},
				TEST_TIMEOUT
			);

			it(
				'should filter with _endsWith',
				async () => {
					const fields = { id: {}, name: {} };
					const filter = { name_endsWith: 'Baggins' };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThanOrEqual(1);
					dbResults.forEach((row: any) => {
						expect(row.name.endsWith('Baggins')).toBe(true);
					});
				},
				TEST_TIMEOUT
			);

			it(
				'should filter with _nlike (negated LIKE)',
				async () => {
					const fields = { id: {}, name: {} };
					const filter = { name_nlike: '%Baggins%' };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
					dbResults.forEach((row: any) => {
						expect(row.name.includes('Baggins')).toBe(false);
					});
				},
				TEST_TIMEOUT
			);

			it(
				'should filter with _nilike (negated ILIKE)',
				async () => {
					const fields = { id: {}, name: {} };
					const filter = { name_nilike: '%gandalf%' };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
					dbResults.forEach((row: any) => {
						expect(row.name.toLowerCase()).not.toContain('gandalf');
					});
				},
				TEST_TIMEOUT
			);
		});

		// ── Null operators ─────────────────────────────────────────────────

		describe('_is_null operator', () => {
			it(
				'should find persons where age IS NULL',
				async () => {
					const fields = { id: {}, name: {}, age: {} };
					const filter = { age_is_null: true };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThanOrEqual(1);
					dbResults.forEach((row: any) => {
						expect(row.age).toBeNull();
					});
				},
				TEST_TIMEOUT
			);

			it(
				'should find persons where age IS NOT NULL',
				async () => {
					const fields = { id: {}, name: {}, age: {} };
					const filter = { age_is_null: false };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
					dbResults.forEach((row: any) => {
						expect(row.age).not.toBeNull();
					});
				},
				TEST_TIMEOUT
			);
		});

		// ── Regex / between operators ──────────────────────────────────────

		describe('_nre and _nbetween operators', () => {
			it(
				'should filter with _nre (negated regex)',
				async () => {
					const fields = { id: {}, name: {} };
					// Match names that do NOT contain "Baggins"
					const filter = { name_nre: 'Baggins' };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(dbResults.length).toBeGreaterThan(0);
					dbResults.forEach((row: any) => {
						expect(row.name).not.toMatch(/Baggins/);
					});
				},
				TEST_TIMEOUT
			);

			it(
				'should filter with _nbetween (NOT BETWEEN range)',
				async () => {
					const fields = { id: {}, name: {}, age: {} };
					// Persons whose age is NOT between 30 and 100
					const filter = { age_nbetween: [30, 100] };

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					// Every returned row either has null age or age outside [30,100]
					dbResults.forEach((row: any) => {
						if (row.age !== null) {
							expect(row.age < 30 || row.age > 100).toBe(true);
						}
					});
				},
				TEST_TIMEOUT
			);
		});

		describe('Inline filter operators on NESTED relation fields', () => {
		// These tests exercise the path: requiresRelations → recursiveMap →
		// filterProcessor.mapFilter(). The new operators must work as inline
			// filters on nested relations, not just at the root level.

			it(
				'should apply _startsWith as inline filter on nested 1:m books',
				async () => {
					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, fb: {} } as any,
						entity: Author,
						customFields: {
							fb: {
								type: () => Book,
								requiresRelations: {
									books: {
										as: '_fb',
										fields: { id: {}, title: {} },
										filter: { title_startsWith: 'The' },
									},
								},
								resolve: (r: any) => r._fb,
							},
						} as any,
					});

					expect(result.querySQL).toContain('like');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);

			it(
				'should apply _not as inline filter on nested 1:m books',
				async () => {
					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, fb: {} } as any,
						entity: Author,
						customFields: {
							fb: {
								type: () => Book,
								requiresRelations: {
									books: {
										as: '_fb',
										fields: { id: {}, title: {} },
										filter: { _not: [{ title_eq: 'Silmarillion' }] },
									},
								},
								resolve: (r: any) => r._fb,
							},
						} as any,
					});

					expect(result.querySQL).toContain('not (');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);

			it(
				'should apply _and with multiple operators as inline filter on nested 1:m',
				async () => {
					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, fb: {} } as any,
						entity: Author,
						customFields: {
							fb: {
								type: () => Book,
								requiresRelations: {
									books: {
										as: '_fb',
										fields: { id: {}, title: {}, pages: {} },
										filter: {
											_and: [
												{ title_startsWith: 'The' },
												{ pages_nbetween: [1000, 2000] },
											],
										},
									},
								},
								resolve: (r: any) => r._fb,
							},
						} as any,
					});

					expect(result.querySQL).toContain('like');
					expect(result.querySQL).toContain('not between');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);

			it(
				'should apply _or as inline filter on nested m:m books',
				async () => {
					const result = mapper.buildQueryAndBindingsFor({
						fields: { id: {}, name: {}, fb: {} } as any,
						entity: Genre,
						customFields: {
							fb: {
								type: () => Book,
								requiresRelations: {
									books: {
										as: '_fb',
										fields: { id: {}, title: {} },
										filter: {
											_or: [
												{ title_startsWith: 'The' },
												{ title_endsWith: 'Rings' },
											],
										},
									},
								},
								resolve: (r: any) => r._fb,
							},
						} as any,
					});

					expect(result.querySQL).toContain('or');

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);
		});
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
