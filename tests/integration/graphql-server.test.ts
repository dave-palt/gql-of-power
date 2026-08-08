/**
 * GraphQL Server Integration Test
 *
 * This test creates a real GraphQL server using the gql-of-power library
 * to define its schema, then makes actual HTTP requests to test the
 * complete end-to-end functionality.
 *
 * The test demonstrates:
 * - Creating GraphQL types using the library's entity system
 * - Setting up resolvers that use GQLQueryManager
 * - Starting a real GraphQL server with Bun
 * - Making HTTP requests to query the API
 * - Testing various relationship scenarios and filtering
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { GraphQLResolveInfo } from 'graphql';
import { GraphQLJSON } from 'graphql-type-json';
import { createYoga } from 'graphql-yoga';
import 'reflect-metadata';
import {
	Arg,
	buildSchema,
	Field,
	Info,
	InputType,
	Int,
	Query,
	Resolver,
	registerEnumType,
} from 'type-graphql';

import { SQL } from 'bun';
import { join } from 'path';
import { createGQLTypes } from '../../src/entities/gql-entity';
import { GQLQueryManager } from '../../src/query-manager';
import { FieldSettings, RelatedFieldSettings } from '../../src/types';
import { DatabaseMetadataProvider } from '../fixtures/database-metadata-provider';
import { Battle, Fellowship, Person, Ring, Weapon } from '../fixtures/middle-earth-schema';
import { AllSampleData } from '../fixtures/test-data';
import { getTestDBConfig } from '../fixtures/test-db-config';

// ─── Enum for mapNumericEnum live-DB test ───────────────────────────────────
// DB stores the numeric code (100/200/300); GraphQL exposes the string key.
enum RingStatus {
	Forged = 100,
	Lost = 200,
	Destroyed = 300,
}
registerEnumType(RingStatus, { name: 'RingStatus' });

// Test server configuration
const TEST_PORT = 4455;
const TEST_URL = `http://localhost:${TEST_PORT}/graphql`;

// Database configuration (resolves DATABASE_URL / POSTGRES_* / DB_* env vars)
const DB_CONFIG = getTestDBConfig();

// GraphQL Server Setup
let server: any;
let sql: SQL;
let metadataProvider: DatabaseMetadataProvider;
let queryManager: GQLQueryManager;

// Check if database schema exists
const schemaPath = join(__dirname, '../fixtures/database-schema.sql');
const schemaExists = await Bun.file(schemaPath).exists();

// Create GraphQL types for our Middle-earth entities
const PersonFields: Partial<Record<keyof Person, FieldSettings | RelatedFieldSettings<any>>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	age: { type: () => Number, options: { nullable: true }, generateFilter: true },
	race: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	home: { type: () => String, options: { nullable: true }, generateFilter: true },
	ring: {
		type: () => RingGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Ring',
		getFilterType: () => Int,
	},
	fellowship: {
		type: () => FellowshipGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Fellowship',
		getFilterType: () => Int,
	},
	battles: {
		type: () => BattleGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Battle',
		getFilterType: () => Int,
	},
};

const RingFields: Partial<Record<keyof Ring, FieldSettings | RelatedFieldSettings<any>>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	power: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	forgedBy: { type: () => String, options: { nullable: true }, generateFilter: true },
	// Server-managed timestamp — kept out of the auto-generated Input type.
	forgedDate: {
		type: () => Date,
		options: { nullable: true },
		generateFilter: true,
		excludeFromInput: true,
	},
	// Numeric enum column: DB stores 100/200/300, GQL exposes Forged/Lost/Destroyed.
	status: {
		type: () => RingStatus,
		options: { nullable: true },
		generateFilter: true,
		mapNumericEnum: true,
	},
	// jsonb column wrapped with a JSON-parsing expression in SQL.
	metadata: {
		type: () => GraphQLJSON,
		options: { nullable: true },
		generateFilter: false,
		parseJson: true,
	},
	bearer: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
	},
};

const FellowshipFields: Partial<
	Record<keyof Fellowship, FieldSettings | RelatedFieldSettings<any>>
> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	purpose: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	disbanded: { type: () => Boolean, options: { nullable: true }, generateFilter: true },
	members: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
		// Auto-generated Int field `memberCount` with its own filter argument.
		countFieldName: 'memberCount',
	},
};

const BattleFields: Partial<Record<keyof Battle, FieldSettings | RelatedFieldSettings<any>>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true }, // Make nullable to handle DB data
	outcome: { type: () => String, options: { nullable: true }, generateFilter: true },
	casualties: { type: () => Number, options: { nullable: true }, generateFilter: true },
	warriors: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
	},
};

// ─── Weapon entity (used by mapping custom-field filter test) ────────────────
const WeaponFields: Partial<Record<keyof Weapon, FieldSettings | RelatedFieldSettings<any>>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	type: { type: () => String, options: { nullable: true }, generateFilter: true },
	power: { type: () => Number, options: { nullable: true }, generateFilter: true },
};

// Create GQL types using the library
const WeaponGQL = createGQLTypes(Weapon, WeaponFields);
const PersonGQL = createGQLTypes(Person, PersonFields, {
	customFields: {
		signatureWeapon: {
			type: () => WeaponGQL.GQLEntity,
			options: { nullable: true },
			generateFilter: true,
			mapping: {
				refEntity: Weapon,
				refFields: 'id',
				fields: 'signatureWeaponId',
			},
		},
	},
});
const RingGQL = createGQLTypes(Ring, RingFields);
const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields);
const BattleGQL = createGQLTypes(Battle, BattleFields);

@InputType('TestInput')
class TestInput {
	@Field(() => Int, {
		nullable: true,
	})
	limit?: number;
}
// Resolvers using GQLQueryManager — extend FieldsResolver so that
// mapNumericEnum, parseJson, and other auto-generated field resolvers work.
@Resolver(() => PersonGQL.GQLEntity)
class PersonResolver extends PersonGQL.FieldsResolver {
	@Query(() => [PersonGQL.GQLEntity], { description: 'Get all persons from Middle-earth' })
	async persons(
		@Info() info: GraphQLResolveInfo,
		@Arg('input', () => TestInput, { nullable: true }) input?: TestInput,
		@Arg('filter', () => PersonGQL.GQLEntityFilterInput, { nullable: true }) filter?: any,
		@Arg('pagination', () => PersonGQL.GQLEntityPaginationInputField, { nullable: true })
		pagination?: any
	): Promise<any[]> {
		console.log('Input received in persons query:', input);
		return await queryManager.getQueryResultsForInfo(
			metadataProvider,
			Person,
			info,
			filter,
			pagination
		);
	}

	@Query(() => PersonGQL.GQLEntity, { nullable: true, description: 'Get a person by ID' })
	async person(
		@Arg('id', () => Number) id: number,
		@Info() info: GraphQLResolveInfo
	): Promise<any> {
		const results = await queryManager.getQueryResultsForInfo(metadataProvider, Person, info, {
			id,
		} as any);
		return results[0] || null;
	}
}

@Resolver(() => RingGQL.GQLEntity)
class RingResolver extends RingGQL.FieldsResolver {
	@Query(() => [RingGQL.GQLEntity], { description: 'Get all rings of power' })
	async rings(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => RingGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Ring, info, filter);
	}
}

@Resolver(() => FellowshipGQL.GQLEntity)
class FellowshipResolver extends FellowshipGQL.FieldsResolver {
	@Query(() => [FellowshipGQL.GQLEntity], { description: 'Get all fellowships' })
	async fellowships(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => FellowshipGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Fellowship, info, filter);
	}
}

@Resolver(() => BattleGQL.GQLEntity)
class BattleResolver extends BattleGQL.FieldsResolver {
	@Query(() => [BattleGQL.GQLEntity], { description: 'Get all battles from Middle-earth history' })
	async battles(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => BattleGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Battle, info, filter);
	}
}

@Resolver(() => WeaponGQL.GQLEntity)
class WeaponResolver extends WeaponGQL.FieldsResolver {
	@Query(() => [WeaponGQL.GQLEntity], { description: 'Get all weapons from Middle-earth' })
	async weapons(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => WeaponGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Weapon, info, filter);
	}
}

const describeOrSkip = schemaExists ? describe : describe.skip;

describe('GraphQL Server Integration Tests', () => {
	describeOrSkip('Real Database Tests', () => {
		beforeAll(async () => {
			console.log('🚀 Setting up GraphQL server integration tests...');
			console.log('📊 Database config:', { ...DB_CONFIG, password: '***' });

			try {
				// Ensure the test database exists. CI's service container pre-creates
				// it (POSTGRES_DB); CREATE only succeeds locally. Connect to the
				// maintenance DB ('postgres') to CREATE, then to the target.
				try {
					const adminSql = new SQL(DB_CONFIG.maintenanceUrl);
					const safeDbName = DB_CONFIG.database.replace(/[^a-zA-Z0-9_]/g, '');
					await adminSql.query(`CREATE DATABASE ${safeDbName};`);
					console.log(`✅ Database ${DB_CONFIG.database} created`);
					await adminSql.close();
				} catch (e) {
					console.log('📝 Test database already exists or creation failed - continuing...');
				}

				// Create SQL connection to the test database
				sql = new SQL(DB_CONFIG.url);

				await sql`select 1`;
				console.log('✅ Database connection established');

				try {
					// Load and execute schema
					await sql.file(schemaPath);
					console.log('✅ Database schema created');

					// Load test data
					await loadTestData();
					console.log('✅ Test data loaded');
				} catch (e) {
					console.error('❌ Error setting up database schema or loading data:', e);
				}

				// Create real metadata provider with database connection
				metadataProvider = new DatabaseMetadataProvider(sql);

				// Initialize query manager
				queryManager = new GQLQueryManager({ namedParameterPrefix: ':' });

				// Build GraphQL schema
				const schema = await buildSchema({
					resolvers: [
						PersonResolver,
						RingResolver,
						FellowshipResolver,
						BattleResolver,
						WeaponResolver,
					],
					validate: false, // Skip validation for faster testing
				});

				// Create GraphQL Yoga server
				const yoga = createYoga({
					schema,
					graphiql: {
						title: 'Middle-earth GraphQL API',
						defaultQuery: `
query TestQuery {
  persons(filter: { race: "Hobbit" }) {
    id
    name
    race
    age
    ring {
      id
      name
      power
    }
    fellowship {
      id
      name
      purpose
    }
  }
}
                    `.trim(),
					},
				});

				// Start server using Bun's native server
				server = Bun.serve({
					port: TEST_PORT,
					fetch: yoga as any,
				});

				console.log(`✅ GraphQL server running at ${TEST_URL}`);

				// Wait a moment for server to be ready
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (error) {
				console.error('❌ Failed to setup GraphQL server:', error);
				throw error;
			}
		});

		afterAll(async () => {
			console.log('🧹 Cleaning up GraphQL server...');
			if (server) {
				server.stop(true);
			}
			if (metadataProvider) {
				await metadataProvider.close();
			}
			if (sql) {
				await sql.end();
			}
			console.log('✅ GraphQL server cleanup complete');
		});

		// Helper function to load test data
		async function loadTestData(): Promise<void> {
			console.log('📊 Loading test data...');

			// Insert data in dependency order to avoid foreign key violations
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
						// Use Bun's SQL template for inserting data
						await sql`INSERT INTO ${sql.unsafe(table)} ${sql(data)}`;
					} catch (error) {
						console.error(`Error inserting into ${table}:`, error);
						console.error('Data sample:', data[0]);
						throw error;
					}
				}
			}

			console.log('✅ Test data loading complete');
		}

		describe('Basic GraphQL Operations', () => {
			it('should handle introspection query', async () => {
				const query = `
                query IntrospectionQuery {
                    __schema {
                        types {
                            name
                            kind
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.data).toBeDefined();
				expect(result.data.__schema).toBeDefined();
				expect(result.data.__schema.types).toBeInstanceOf(Array);

				// Should contain our generated types
				const typeNames = result.data.__schema.types.map((t: any) => t.name);
				expect(typeNames).toContain('Person');
				expect(typeNames).toContain('Ring');
				expect(typeNames).toContain('Fellowship');
				expect(typeNames).toContain('Battle');
			});

			it('should query persons with basic fields', async () => {
				const query = `
                query GetPersons {
                    persons {
                        id
                        name
                        race
                        age
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);
				expect(result.data.persons.length).toBeGreaterThan(0);

				// Check that we have Hobbits from our test data
				const hobbits = result.data.persons.filter((p: any) => p.race === 'Hobbit');
				expect(hobbits.length).toBeGreaterThan(0);
				expect(hobbits.some((h: any) => h.name.includes('Frodo'))).toBe(true);
			});

			it('should query a specific person by ID', async () => {
				const query = `
                query GetPerson($id: Float!) {
                    person(id: $id) {
                        id
                        name
                        race
                        age
                        home
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						query,
						variables: { id: 1 },
					}),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.person).toBeDefined();
				expect(result.data.person.id).toBe(1);
				expect(result.data.person.name).toBeDefined();
			});

			it('should filter persons with _nin operator', async () => {
				const query = `
					query PersonsNotIn {
						persons(filter: { name_nin: ["Legolas", "Frodo"] }) {
							id
							name
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeInstanceOf(Array);
				result.data.persons.forEach((person: any) => {
					expect(['Legolas', 'Frodo']).not.toContain(person.name);
				});
			});

			it('should filter persons with _gt operator', async () => {
				const query = `
					query PersonsGt {
						persons(filter: { age_gt: 100 }) {
							id
							name
							age
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				result.data.persons.forEach((person: any) => {
					expect(person.age).toBeGreaterThan(100);
				});
			});

			it('should filter persons with _gte operator', async () => {
				const query = `
					query PersonsGte {
						persons(filter: { age_gte: 2931 }) {
							id
							name
							age
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				result.data.persons.forEach((person: any) => {
					expect(person.age).toBeGreaterThanOrEqual(2931);
				});
			});

			it('should filter persons with _lt operator', async () => {
				const query = `
					query PersonsLt {
						persons(filter: { age_lt: 100 }) {
							id
							name
							age
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				result.data.persons.forEach((person: any) => {
					expect(person.age).toBeLessThan(100);
				});
			});

			it('should filter persons with _lte operator', async () => {
				const query = `
					query PersonsLte {
						persons(filter: { age_lte: 87 }) {
							id
							name
							age
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				result.data.persons.forEach((person: any) => {
					expect(person.age).toBeLessThanOrEqual(87);
				});
			});

			it('should filter persons with _like operator', async () => {
				const query = `
					query PersonsLike {
						persons(filter: { name_like: "%ego%" }) {
							id
							name
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				const names = result.data.persons.map((p: any) => p.name.toLowerCase());
				expect(names.some((n: string) => n.includes('ego'))).toBe(true);
			});

			it('should filter persons with _re operator', async () => {
				const query = `
					query PersonsRe {
						persons(filter: { name_re: "^Legolas$" }) {
							id
							name
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons.length).toBeGreaterThan(0);
				result.data.persons.forEach((person: any) => {
					expect(person.name).toBe('Legolas');
				});
			});

			it('should filter persons with _ilike operator', async () => {
				const query = `
					query PersonsIlike {
						persons(filter: { name_ilike: "%LEGOLAS%" }) {
							id
							name
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons.length).toBeGreaterThan(0);
				result.data.persons.forEach((person: any) => {
					expect(person.name.toLowerCase()).toContain('legolas');
				});
			});

			it('should filter persons with _fulltext operator', async () => {
				const query = `
					query PersonsFulltext {
						persons(filter: { name_fulltext: "Frodo" }) {
							id
							name
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeInstanceOf(Array);
				// Should find Frodo in results
				expect(result.data.persons.some((p: any) => p.name.includes('Frodo'))).toBe(true);
			});

			it('should filter persons with _overlap operator', async () => {
				const query = `
					query PersonsOverlap {
						persons(filter: { battles_overlap: [1, 2] }) {
							id
							name
							battles {
								id
								name
							}
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeInstanceOf(Array);
				// Should find persons who participated in either battle 1 or 2
				result.data.persons.forEach((person: any) => {
					const battleIds = (person.battles ?? []).map((b: any) => b.id);
					console.log('battleIOds', battleIds);
					expect(battleIds.some((id: number) => [1, 2].includes(id))).toBe(true);
				});
			});

			it('should filter persons with _contains operator', async () => {
				const query = `
					query PersonsContains {
						persons(filter: { battles_contains: [1] }) {
							id
							name
							battles {
								id
								name
							}
						}
					}
				`;
				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});
				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeInstanceOf(Array);
				// Should find persons who participated in battle 1
				result.data.persons.forEach((person: any) => {
					const battleIds = (person.battles ?? []).map((b: any) => b.id);
					expect(battleIds).toContain(1);
				});
			});
		});

		describe('Relationship Queries', () => {
			it('should query persons with their rings (1:1 relationship)', async () => {
				const query = `
                query GetPersonsWithRings {
                    persons(filter: { Ring: { id_ne: null } }) {
                        id
                        name
                        race
                        ring {
                            id
                            name
                            power
                            forgedBy
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// Should find persons who have rings
				const personsWithRings = result.data.persons.filter((p: any) => p.ring !== null);
				expect(personsWithRings.length).toBeGreaterThan(0);

				const personWithRing = personsWithRings[0];
				expect(personWithRing.ring.id).toBeDefined();
				expect(personWithRing.ring.name).toBeDefined();
				expect(personWithRing.ring.power).toBeDefined();
			});

			it('should query fellowships with members (1:m relationship)', async () => {
				const query = `
                query GetFellowshipsWithMembers {
                    fellowships {
                        id
                        name
                        purpose
                        disbanded
                        members {
                            id
                            name
                            race
                            age
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.fellowships).toBeInstanceOf(Array);

				const fellowship = result.data.fellowships.find(
					(f: any) => f.name === 'Fellowship of the Ring'
				);
				expect(fellowship).toBeDefined();
				expect(fellowship.members).toBeInstanceOf(Array);
				expect(fellowship.members.length).toBeGreaterThan(0);

				// Should have diverse races in the fellowship
				const races = fellowship.members.map((m: any) => m.race);
				expect(new Set(races).size).toBeGreaterThan(1); // Multiple races
			});

			it('should query battles with warriors (m:m relationship)', async () => {
				const query = `
                query GetBattlesWithWarriors {
                    battles {
                        id
                        name
                        outcome
                        casualties
                        warriors {
                            id
                            name
                            race
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.battles).toBeInstanceOf(Array);

				if (result.data.battles.length > 0) {
					const battleWithWarriors = result.data.battles.find(
						(b: any) => b.warriors && b.warriors.length > 0
					);

					if (battleWithWarriors) {
						expect(battleWithWarriors.warriors).toBeInstanceOf(Array);
						expect(battleWithWarriors.warriors[0].name).toBeDefined();
						expect(battleWithWarriors.warriors[0].race).toBeDefined();
					}
				}
			});
		});

		describe('Advanced Filtering', () => {
			it('should filter persons by race', async () => {
				const query = `
                query GetHobbits {
                    persons(filter: { race: "Hobbit" }) {
                        id
                        name
                        race
                        age
                        home
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// All returned persons should be Hobbits
				result.data.persons.forEach((person: any) => {
					expect(person.race).toBe('Hobbit');
				});
			});

			it('should handle OR conditions', async () => {
				const query = `
                query GetHobbitsOrElves {
                    persons(filter: { 
                        _or: [
                            { race: "Hobbit" },
                            { race: "Elf" }
                        ]
                    }) {
                        id
                        name
                        race
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// All returned persons should be either Hobbits or Elves
				result.data.persons.forEach((person: any) => {
					expect(['Hobbit', 'Elf']).toContain(person.race);
				});
			});

			it('should handle nested relationship filtering', async () => {
				const query = `
                query GetPersonsInFellowshipOfRing {
                    persons(filter: { 
                        Fellowship: { 
                            name_eq: "Fellowship of the Ring" 
                        }
                    }) {
                        id
                        name
                        race
                        fellowship {
                            id
                            name
                            purpose
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();

				// console.log(result?.data?.persons);
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// All returned persons should be members of Fellowship of the Ring
				result.data.persons.forEach((person: any) => {
					if (person.fellowship) {
						expect(person.fellowship.name).toBe('Fellowship of the Ring');
					}
				});
			});

			it('should handle many to one relationship', async () => {
				const query = `
                query MyQuery {
					persons {
						id
						name
						ring {
							id
							name
						}
					}
				}
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();

				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// All returned persons should be members of Fellowship of the Ring
				result.data.persons.forEach((person: any) => {
					if (person.ring) {
						expect(person.ring).toBeObject();
						expect(person.ring.id).toBeNumber();
						expect(person.ring.name).toBeString();
					}
				});
			});
		});

		describe('Complex Nested Queries', () => {
			it('should handle deeply nested relationship queries', async () => {
				const query = `
                query GetDeepNestedData {
                    persons(filter: { race: "Hobbit" }) {
                        id
                        name
                        race
                        ring {
                            id
                            name
                            power
                        }
                        fellowship {
                            id
                            name
                            purpose
                            members {
                                id
                                name
                                race
                            }
                        }
                        battles {
                            id
                            name
                            outcome
                            warriors {
                                id
                                name
                                race
                            }
                        }
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.persons).toBeInstanceOf(Array);

				// Verify the nested structure is properly returned
				const hobbit = result.data.persons.find((p: any) => p.race === 'Hobbit');
				if (hobbit) {
					expect(hobbit.race).toBe('Hobbit');

					// Check nested relationships are properly structured
					if (hobbit.ring) {
						expect(hobbit.ring).toHaveProperty('id');
						expect(hobbit.ring).toHaveProperty('name');
						expect(hobbit.ring).toHaveProperty('power');
					}

					if (hobbit.fellowship) {
						expect(hobbit.fellowship).toHaveProperty('id');
						expect(hobbit.fellowship).toHaveProperty('name');
						expect(hobbit.fellowship).toHaveProperty('members');

						if (hobbit.fellowship.members && hobbit.fellowship.members.length > 0) {
							expect(hobbit.fellowship.members[0]).toHaveProperty('name');
							expect(hobbit.fellowship.members[0]).toHaveProperty('race');
						}
					}
				}
			});

			it('should support GraphQL fragments and field aliasing in nested relationships', async () => {
				const query = `
fragment Person on Person {
    id
    name
    race
}
fragment PersonWithBattles on Person {
    battles(pagination:  {
      limit: 1
      offset: 1
       orderBy: [ {
          name: ASC
       }]
       })
    {
      id
      name
    }
}

query GetMixedData {
   hobbits: persons(
     filter: {race_eq: "Hobbit"}
   ) {
     ...Person
     ...PersonWithBattles
   }
   elfsWithAllBattles: persons(
     filter: {race_eq: "Elf"}
   ) {
     ...Person
     battles(pagination:  {
 		orderBy: [ {
 			name: DESC
 		}]
        })
     {
       id
       name
     }
   }
  elfs: persons(
    filter: {race_eq: "Elf"}
  ) {
    ...Person
    ...PersonWithBattles
  }
}
			`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();

				console.log(JSON.stringify(result, null, 2));
				expect(result.errors).toBeUndefined();
				expect(result.data).toBeDefined();
				expect(result.data.hobbits).toBeArray();

				// No hobbits with battles (just bad data input)
				result.data.hobbits.forEach((hobbit: any) => {
					expect(hobbit.battles).toBeArray();
					expect(hobbit.battles).toBeEmpty();
				});

				expect(result.data.elfs).toBeArrayOfSize(1);
				expect(result.data.elfsWithAllBattles).toBeArrayOfSize(1);

				const [legolas] = result.data.elfs;
				const [legolasBattles] = result.data.elfsWithAllBattles;
				expect(legolas.battles).toBeArray();
				expect(legolas.battles).toBeArrayOfSize(1);
				expect(legolasBattles.battles).toBeArray();
				expect(legolasBattles.battles).toBeArrayOfSize(2);

				const [boPelennorFields] = legolas.battles;
				const [boPelennorFields2, boHelmDeep] = legolasBattles.battles;

				expect(boPelennorFields).toEqual(boPelennorFields2);
				expect(boHelmDeep.name).toBeString();
				expect(boHelmDeep.name).toContain('Helm');
			});
		});

		describe('mapNumericEnum — live DB conversion', () => {
			it('should query rings and return enum string keys for numeric status column', async () => {
				const query = `
				query GetRingsWithStatus {
				rings {
				id
				name
				status
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.rings).toBeArrayOfSize(3);

				// DB stores 100/200/300; GraphQL should expose Forged/Lost/Destroyed
				const statuses = result.data.rings.map((r: any) => r.status).sort();
				expect(statuses).toEqual(['Destroyed', 'Forged', 'Lost']);
			});

			it('should filter rings by enum string key (converted to numeric for SQL)', async () => {
				// The filter receives the GQL enum value Forged, which must be
				// converted to the DB numeric value 100 for the WHERE clause.
				const query = `
				query FilterByForged {
				rings(filter: { status: Forged }) {
				id
				name
				status
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.rings).toBeArrayOfSize(1);
				expect(result.data.rings[0].status).toBe('Forged');
				expect(result.data.rings[0].name).toContain('One Ring');
			});

			it('should filter rings by enum using _in operator', async () => {
				const query = `
				query FilterByMultipleStatuses {
				rings(filter: { status_in: [Lost, Destroyed] }) {
				id
				name
				status
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.rings).toBeArrayOfSize(2);
			});
		});

		describe('parseJson — jsonb column', () => {
			it('should return parsed JSON object from jsonb column', async () => {
				const query = `
				query GetRingsWithMetadata {
				rings {
				id
				name
				metadata
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.rings).toBeArrayOfSize(3);

				// Each ring should have a parsed metadata object
				for (const ring of result.data.rings) {
					expect(ring.metadata).toBeObject();
				}

				const oneRing = result.data.rings.find((r: any) => r.name === 'The One Ring');
				expect(oneRing.metadata.inscription).toBe('Ash nazg durbatulûk');
				expect(oneRing.metadata.age).toBe(3000);
			});
		});

		describe('Count fields — correlated COUNT(*) subquery', () => {
			it('should return memberCount for fellowships', async () => {
				const query = `
				query GetFellowshipCounts {
				fellowships {
				id
				name
				memberCount
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.fellowships).toBeArray();

				// Fellowship of the Ring has 4 Hobbits + others in sample data
				const fotr = result.data.fellowships.find((f: any) => f.name === 'Fellowship of the Ring');
				expect(fotr).toBeDefined();
				expect(fotr.memberCount).toBeGreaterThan(0);
			});

			it('should filter fellowships by memberCount_gt', async () => {
				const query = `
				query FilterByMemberCount {
				fellowships(filter: { memberCount_gt: 2 }) {
				id
				name
				memberCount
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.fellowships).toBeArray();
				// Every returned fellowship should have > 2 members
				for (const f of result.data.fellowships) {
					expect(f.memberCount).toBeGreaterThan(2);
				}
			});
		});

		describe('_exists / _not_exists — EXISTS subqueries', () => {
			it('should filter persons by _exists on battles (array relation)', async () => {
				// `battles` is an array relation on Person → generates EXISTS subquery.
				// Find persons that have at least one battle with > 500 casualties.
				const query = `
				query ExistsFilter {
				persons(filter: { _exists: { battles: { casualties_gt: 500 } } }) {
				id
				name
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeArray();
				expect(result.data.persons.length).toBeGreaterThan(0);
			});

			it('should filter persons by _not_exists on battles (array relation)', async () => {
				// Find persons that do NOT have any battle with > 500 casualties.
				const query = `
				query NotExistsFilter {
				persons(filter: { _not_exists: { battles: { casualties_gt: 500 } } }) {
				id
				name
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeArray();

				// Frodo (id 1) has no battles — should be present
				const frodo = result.data.persons.find((p: any) => p.name === 'Frodo Baggins');
				expect(frodo).toBeDefined();
			});

			it('should filter fellowships by _exists on members (array relation)', async () => {
				// Find fellowships that have at least one Hobbit member.
				const query = `
				query FellowshipExists {
				fellowships(filter: { _exists: { members: { race: "Hobbit" } } }) {
				id
				name
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.fellowships).toBeArray();
				expect(result.data.fellowships.length).toBeGreaterThan(0);
			});
		});

		describe('Mapping custom-field filter — EXISTS subquery', () => {
			it('should filter persons by signatureWeapon mapped field', async () => {
				// The signatureWeapon is a custom field with mapping strategy.
				// Filtering on it generates: EXISTS (SELECT 1 FROM weapons WHERE ...).
				// Note: filter keys for custom fields are capitalized (SignatureWeapon),
				// while the selection field is camelCase (signatureWeapon).
				const query = `
				query FilterByWeaponPower {
				persons(filter: { SignatureWeapon: { power_gt: 80 } }) {
				id
				name
				signatureWeapon {
				id
				name
				power
				}
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeArray();
				// Every returned person should have a weapon with power > 80
				for (const p of result.data.persons) {
					expect(p.signatureWeapon).toBeDefined();
					expect(p.signatureWeapon.power).toBeGreaterThan(80);
				}
			});

			it('should filter persons by signatureWeapon name', async () => {
				const query = `
				query FilterByWeaponName {
				persons(filter: { SignatureWeapon: { name: "Sting" } }) {
				id
				name
				signatureWeapon {
				name
				}
				}
				}
				`;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeUndefined();
				expect(result.data.persons).toBeArray();
				// Frodo wields Sting
				const frodo = result.data.persons.find((p: any) => p.name === 'Frodo Baggins');
				expect(frodo).toBeDefined();
				expect(frodo.signatureWeapon.name).toBe('Sting');
			});
		});

		describe('Error Handling', () => {
			it('should handle malformed queries gracefully', async () => {
				const query = `
                query MalformedQuery {
                    persons {
                        nonExistentField
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				expect(response.status).toBe(200);
				const result = await response.json();
				expect(result.errors).toBeDefined();
				expect(result.errors.length).toBeGreaterThan(0);
			});

			it('should handle invalid filter values', async () => {
				const query = `
                query InvalidFilter {
                    persons(filter: { id: "not_a_number" }) {
                        id
                        name
                    }
                }
            `;

				const response = await fetch(TEST_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query }),
				});

				// Should either return an error or handle gracefully
				const result = await response.json();

				expect(response.status).toBe(200);
				expect(result.errors).toBeDefined();
			});
		});
	});

	// Skip message if schema doesn't exist
	if (!schemaExists) {
		console.log('⚠️  Skipping GraphQL server integration tests - database-schema.sql not found');
		console.log('📝 To run these tests, ensure the database schema file exists at:', schemaPath);
	}
});
