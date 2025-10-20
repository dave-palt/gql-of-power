/**
 * Database Integration Tests for GQL-of-Power
 *
 * This test suite connects to a real PostgreSQL database using Bun's native database support.
 * It sets up test data in a transaction, runs comprehensive GraphQL-to-SQL scenarios covering
 * all relationship types, and rolls back the transaction to ensure no data persistence.
 *
 * Environment Variables:
 * - DATABASE_URL: PostgreSQL connection string (default: postgresql://localhost:5432/gql_of_power_test)
 * - DB_HOST: Database host (default: localhost)
 * - DB_PORT: Database port (default: 5432)
 * - DB_NAME: Database name (default: gql_of_power_test)
 * - DB_USER: Database user (default: postgres)
 * - DB_PASSWORD: Database password (default: empty)
 */
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'fs';
import knex from 'knex';
import { join } from 'path';
import { FieldSelection, GQLEntityPaginationInputType } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { getGQLFields, GQLQueryManager } from '../../src/query-manager';
import { DatabaseMetadataProvider } from '../fixtures/database-metadata-provider';
import { Battle, Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import { AllSampleData } from '../fixtures/test-data';
import '../setup';

// Database configuration
const DB_CONFIG = {
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '5432'),
	database: 'gql_of_power_test',
	username: process.env.DB_USER || 'postgres',
	password: process.env.DB_PASSWORD || '',
	url:
		process.env.DATABASE_URL ||
		`postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${
			process.env.DB_HOST || 'localhost'
		}:${process.env.DB_PORT || '5432'}/gql_of_power_test`,
};

// Test timeout for database operations
const TEST_TIMEOUT = 30000; // 30 seconds

const filePath = join(__dirname, '../../', 'tests/fixtures/database-schema.sql');
const schemaFile = Bun.file(filePath);
const exists = await schemaFile.exists();

const describeOrSkip = exists ? describe : describe.skip;

const _getGQLFields = mock(getGQLFields);

const k = knex({ client: 'pg' });

describe('GQL-of-Power Database Integration Tests', () => {
	describeOrSkip('GQL-of-Power Database Integration Tests', () => {
		let sql: SQL;
		let metadataProvider: DatabaseMetadataProvider;
		let mapper: GQLtoSQLMapper;
		let queryManager: GQLQueryManager;

		beforeAll(async () => {
			console.log('🚀 Setting up database integration tests...');
			console.log('📊 Database config:', { ...DB_CONFIG, password: '***' });
			try {
				sql = new SQL(DB_CONFIG.url);
				try {
					await sql`CREATE DATABASE gql_of_power_test;`;
					console.log('✅ Database created');
				} catch (e) {}
				await sql.file(filePath);
				console.log('✅ Database schema created');

				// Create metadata provider and mapper
				metadataProvider = new DatabaseMetadataProvider(sql);
				mapper = new GQLtoSQLMapper(metadataProvider, { namedParameterPrefix: ':' });
				queryManager = new GQLQueryManager({ namedParameterPrefix: ':' });

				console.log('✅ Test infrastructure initialized');
			} catch (error) {
				console.error('❌ Failed to set up database integration tests:', error);
				throw error;
			}
		});

		beforeEach(async () => {
			console.log('🔄 Setting up test data in transaction...');

			try {
				// Insert test data - the actual test will run in a transaction that gets rolled back
				await insertTestData();
				console.log('✅ Test data setup complete');
			} catch (error) {
				console.error('❌ Failed to set up test data:', error);
				throw error;
			}
		});

		afterEach(async () => {
			console.log('🔄 Cleaning up test data...');

			try {
				// Truncate tables in reverse dependency order
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
					} catch (error: any) {
						// Ignore errors for tables that might not exist or be empty
						if (!error.message.includes('does not exist')) {
							console.warn(`Warning truncating ${table}:`, error.message);
						}
					}
				}

				console.log('✅ Test data cleanup complete');
			} catch (error) {
				console.error('❌ Failed to cleanup test data:', error);
			}
		});

		afterAll(async () => {
			console.log('🧹 Cleaning up database integration tests...');

			try {
				if (metadataProvider) {
					await metadataProvider.close();
				}
				if (sql) {
					await sql.end();
				}
				console.log('✅ Database connections closed');
			} catch (error) {
				console.error('❌ Error during cleanup:', error);
			}
		});

		describe('1:1 Relationships (Person <-> Ring)', () => {
			it('should query Person with Ring relationship', async () => {
				await runInTransaction(async (txSql) => {
					const fields = {
						id: {},
						name: {},
						age: {},
						ring: {
							id: {},
							name: {},
							power: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
					});

					console.log('📋 Generated SQL:', result.querySQL);
					console.log('📝 Bindings:', result.bindings);

					// Execute the query against real database within transaction
					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Should find Frodo with the One Ring
					const frodoWithRing = dbResults.find(
						(row) => row && typeof row === 'object' && row.name === 'Frodo Baggins'
					);
					expect(frodoWithRing).toBeDefined();

					return dbResults; // Return result from transaction
				});
			});

			it(
				'should query Ring with bearer relationship',
				async () => {
					const fields = {
						id: {},
						name: {},
						power: {},
						bearer: {
							id: {},
							name: {},
							race: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Ring,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Should find the One Ring with Frodo as bearer
					const oneRingWithBearer = dbResults.find(
						(row) => row && typeof row === 'object' && row.name === 'The One Ring'
					);
					expect(oneRingWithBearer).toBeDefined();
				},
				TEST_TIMEOUT
			);
		});

		describe('1:m Relationships (Fellowship -> Members)', () => {
			it(
				'should query Fellowship with members',
				async () => {
					const fields = {
						id: {},
						name: {},
						purpose: {},
						members: {
							id: {},
							name: {},
							race: {},
							age: {},
						},
					};
					_getGQLFields.mockReturnValue(fields);

					// Mock getGQLFields to return fields

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Should find Fellowship of the Ring with multiple members
					const fellowship = dbResults.find(
						(row) => row && typeof row === 'object' && row.name === 'Fellowship of the Ring'
					);
					expect(fellowship).toBeDefined();
				},
				TEST_TIMEOUT
			);

			it(
				'should filter Fellowship members by race',
				async () => {
					const fields = {
						id: {},
						name: {},
						members: {
							id: {},
							name: {},
							race: {},
						},
					};
					_getGQLFields.mockReturnValue(fields);

					const filter = {
						members: {
							race: 'Hobbit',
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Fellowship,
						customFields: {},
						filter: filter as any,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);
		});

		describe('m:1 Relationships (Person -> Fellowship)', () => {
			it(
				'should query Person with Fellowship',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						fellowship: {
							id: {},
							name: {},
							purpose: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Should find persons with their fellowship information
					const personWithFellowship = dbResults.find(
						(row) => row && typeof row === 'object' && row.name === 'Frodo Baggins'
					);
					expect(personWithFellowship).toBeDefined();
				},
				TEST_TIMEOUT
			);

			it(
				'should filter Person by Fellowship name',
				async () => {
					const fields = {
						id: {},
						name: {},
						fellowship: {
							id: {},
							name: {},
						},
					};
					_getGQLFields.mockReturnValue(fields);

					const filter = {
						fellowship: {
							name: 'Fellowship of the Ring',
						},
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
				},
				TEST_TIMEOUT
			);
		});

		describe('m:m Relationships (Person <-> Battle)', () => {
			it(
				'should query Person with battles',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						battles: {
							id: {},
							name: {},
							outcome: {},
							casualties: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);

			it(
				'should query Battle with warriors',
				async () => {
					const fields = {
						id: {},
						name: {},
						outcome: {},
						warriors: {
							id: {},
							name: {},
							race: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Battle,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
				},
				TEST_TIMEOUT
			);
		});

		describe('Complex Filtering Scenarios', () => {
			it(
				'should handle OR conditions',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						age: {},
					};
					// _getGQLFields.mockReturnValue(fields);

					const filter = {
						_or: [{ name: 'Frodo Baggins' }, { name: 'Gandalf' }, { race: 'Hobbit' }],
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
				},
				TEST_TIMEOUT
			);

			it(
				'should handle complex AND/OR combinations',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						age: {},
					};

					const filter = {
						_or: [
							{
								_and: [{ race: 'Hobbit' }, { age: { _lt: 50 } }],
							},
							{
								_and: [{ race: 'Elf' }, { age: { _gt: 100 } }],
							},
						],
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
				},
				TEST_TIMEOUT
			);
		});

		describe('Pagination and Ordering', () => {
			it(
				'should handle pagination with ordering',
				async () => {
					const fields: FieldSelection<Person> = {
						id: {},
						name: {},
						age: {},
						race: {},
					};

					const pagination: Partial<GQLEntityPaginationInputType<Person>> = {
						orderBy: [{ name: 'asc' as any }, { age: 'desc' as any }],
						limit: 5,
						offset: 2,
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					expect(result.bindings.limit).toBe(5);
					expect(result.bindings.offset).toBe(2);
				},
				TEST_TIMEOUT
			);
		});

		describe('Nested Relationship Queries', () => {
			it(
				'should handle deeply nested relationships',
				async () => {
					const fields = {
						id: {},
						name: {},
						fellowship: {
							id: {},
							name: {},
							quest: {
								id: {},
								name: {},
								description: {},
								locations: {
									id: {},
									name: {},
									type: {},
								},
							},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Verify the SQL contains all expected tables
					expect(result.querySQL.toLowerCase()).toContain('persons');
					expect(result.querySQL.toLowerCase()).toContain('fellowships');
					expect(result.querySQL.toLowerCase()).toContain('quests');
				},
				TEST_TIMEOUT
			);

			it(
				'should handle mixed relationship types in single query',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						// 1:1 relationship
						ring: {
							id: {},
							name: {},
							power: {},
						},
						// m:1 relationship
						fellowship: {
							id: {},
							name: {},
							purpose: {},
						},
						// m:m relationship
						battles: {
							id: {},
							name: {},
							outcome: {},
						},
					};

					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);

					// Verify the SQL contains all expected tables
					expect(result.querySQL.toLowerCase()).toContain('persons');
					expect(result.querySQL.toLowerCase()).toContain('rings');
					expect(result.querySQL.toLowerCase()).toContain('fellowships');
					expect(result.querySQL.toLowerCase()).toContain('battles');
					expect(result.querySQL.toLowerCase()).toContain('person_battles');
				},
				TEST_TIMEOUT
			);
		});

		describe('Performance and Scale Tests', () => {
			it(
				'should handle large result sets efficiently',
				async () => {
					const fields = {
						id: {},
						name: {},
						race: {},
						age: {},
					};

					const pagination = {
						limit: 100,
						orderBy: [{ id: 'asc' as any }],
					};

					const startTime = Date.now();
					const result = mapper.buildQueryAndBindingsFor({
						fields,
						entity: Person,
						customFields: {},
						pagination,
					});

					const dbResults = await metadataProvider.executeQuery(
						k.raw(result.querySQL, result.bindings).toString()
					);
					const executionTime = Date.now() - startTime;

					expect(dbResults).toBeDefined();
					expect(Array.isArray(dbResults)).toBe(true);
					expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds

					console.log(`⚡ Query executed in ${executionTime}ms`);
				},
				TEST_TIMEOUT
			);
		});

		// Helper functions

		/**
		 * Wraps a test function in a transaction that gets rolled back
		 * Uses the throw/catch pattern to force rollback
		 */
		async function runInTransaction<T>(testFn: (sql: SQL) => Promise<T>): Promise<T> {
			let result: T = {} as T;
			const rollback = true; // Always rollback in tests

			try {
				return await sql.begin(async (txSql) => {
					try {
						result = await testFn(txSql);
						return result;
					} catch (e) {
						throw e; // Re-throw actual test errors
					} finally {
						if (rollback) throw 'stop'; // Force rollback
					}
				});
			} catch (e) {
				if (e === 'stop') {
					return result;
				}
				throw e;
			}
		}

		async function setupDatabaseSchema(): Promise<void> {
			const schemaPath = join(__dirname, '../fixtures/database-schema.sql');
			const schemaSql = readFileSync(schemaPath, 'utf-8');

			// Execute all schema statements at once using simple()
			try {
				await sql`${sql.unsafe(schemaSql)}`.simple();
			} catch (error: any) {
				// Log error but don't throw for schema setup issues like table already exists
				console.warn('Schema setup warning:', error.message);
			}
		}

		async function insertTestData(): Promise<void> {
			console.log('📝 Inserting test data...');

			// Insert data in dependency order
			const insertOrder = [
				{ table: 'regions', data: AllSampleData.regions || [] },
				{ table: 'quests', data: AllSampleData.quests || [] },
				{ table: 'fellowships', data: AllSampleData.fellowships || [] },
				{ table: 'persons', data: AllSampleData.persons || [] },
				{ table: 'rings', data: AllSampleData.rings || [] },
				{ table: 'authors', data: AllSampleData.authors || [] },
				{ table: 'genres', data: AllSampleData.genres || [] },
				{ table: 'books', data: AllSampleData.books || [] },
				{ table: 'locations', data: AllSampleData.locations || [] },
				{ table: 'battles', data: AllSampleData.battles || [] },
				{ table: 'armies', data: AllSampleData.armies || [] },
				// Junction tables
				{ table: 'person_battles', data: AllSampleData.person_battles || [] },
				{ table: 'army_battles', data: AllSampleData.army_battles || [] },
				{ table: 'book_characters', data: AllSampleData.book_characters || [] },
				{ table: 'book_genres', data: AllSampleData.book_genres || [] },
				{ table: 'quest_locations', data: AllSampleData.quest_locations || [] },
			];

			for (const { table, data } of insertOrder) {
				if (data.length > 0) {
					console.log(`  📋 Inserting ${data.length} records into ${table}`);

					try {
						// Use Bun's idiomatic sql(record) syntax - works for both single records and arrays
						await sql`INSERT INTO ${sql.unsafe(table)} ${sql(data)}`;
					} catch (error) {
						console.error(`Error inserting into ${table}:`, error);
						console.error('Data:', data);
						throw error;
					}
				}
			}

			console.log('✅ Test data insertion complete');
		}
	});
});
