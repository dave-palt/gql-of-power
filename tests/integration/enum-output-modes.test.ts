/**
 * Integration tests for mapNumericEnum output modes across two schema
 * construction paths:
 *
 * 1. **Live schema** — type-graphql `buildSchema()` directly. Enum values
 *    are preserved as numbers (`{ ACTIVE: { value: 0 } }`). Raw passthrough
 *    works: `serialize(0)` → `"ACTIVE"`.
 *
 * 2. **SDL-rebuilt schema** — `printSchema()` → `buildASTSchema()` →
 *    `addResolversToSchema()`. This mirrors the Apollo Server + pre-generated
 *    `.graphql` file pattern. SDL strips numeric values, so graphql-js
 *    defaults to `{ ACTIVE: { value: "ACTIVE" } }`. CASE WHEN is needed:
 *    `serialize("ACTIVE")` → `"ACTIVE"`.
 *
 * Both paths should return identical JSON: enum field values are string keys.
 *
 * NOTE: The global `mapEnumOutput` setting affects query-time SQL generation,
 * not schema construction. So we can switch it between test suites on the
 * same running server pair.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { GraphQLResolveInfo, buildASTSchema, parse, printSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import 'reflect-metadata';
import {
	Arg,
	buildSchema,
	Field,
	Info,
	Int,
	Query,
	Resolver,
	registerEnumType,
} from 'type-graphql';
import { addResolversToSchema } from '@graphql-tools/schema';
import { getResolversFromSchema } from '@graphql-tools/utils';
import { SQL } from 'bun';
import { join } from 'path';
import { createGQLTypes, setGlobalConfig } from '../../src/entities/gql-entity';
import { GQLQueryManager } from '../../src/query-manager';
import { DatabaseMetadataProvider } from '../fixtures/database-metadata-provider';
import { Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import { AllSampleData } from '../fixtures/test-data';
import { getTestDBConfig } from '../fixtures/test-db-config';

// ─── Enums ───────────────────────────────────────────────────────────────────

enum RingBearerStatus {
	// fallow-ignore-next-line unused-enum-member
	Forged = 100,
	// fallow-ignore-next-line unused-enum-member
	Lost = 200,
	// fallow-ignore-next-line unused-enum-member
	Destroyed = 300,
}
registerEnumType(RingBearerStatus, { name: 'RingBearerStatus' });

enum PersonRank {
	// fallow-ignore-next-line unused-enum-member
	Member = 1,
	// fallow-ignore-next-line unused-enum-member
	Officer = 2,
	// fallow-ignore-next-line unused-enum-member
	Leader = 3,
}
registerEnumType(PersonRank, { name: 'PersonRank' });

// ─── Field definitions ───────────────────────────────────────────────────────

// We use createGQLTypes (the same function the main integration test uses)
// to register fields with mapNumericEnum: true.
// No per-field mapEnumOutput override — the global setting controls the mode.

const PersonFields: any = {
	id: { type: () => Int, generateFilter: true },
	name: { type: () => String, generateFilter: true },
	race: { type: () => String, generateFilter: true },
	rank: {
		type: () => PersonRank,
		mapNumericEnum: true,
		generateFilter: true,
	},
};

const RingFields: any = {
	id: { type: () => Int, generateFilter: true },
	name: { type: () => String, generateFilter: true },
	status: {
		type: () => RingBearerStatus,
		mapNumericEnum: true,
		generateFilter: true,
	},
};

const PersonGQL = createGQLTypes(Person, PersonFields);
const RingGQL = createGQLTypes(Ring, RingFields);

// ─── Resolvers ───────────────────────────────────────────────────────────────

let metadataProvider: DatabaseMetadataProvider;
let queryManager: GQLQueryManager;
let sql: SQL;

@Resolver(() => PersonGQL.GQLEntity)
class PersonResolver extends PersonGQL.FieldsResolver {
	@Query(() => [PersonGQL.GQLEntity])
	async persons(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => PersonGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Person, info, filter);
	}
}

@Resolver(() => RingGQL.GQLEntity)
class RingResolver extends RingGQL.FieldsResolver {
	@Query(() => [RingGQL.GQLEntity])
	async rings(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => RingGQL.GQLEntityFilterInput, { nullable: true }) filter?: any
	): Promise<any[]> {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Ring, info, filter);
	}
}

// ─── Test config ─────────────────────────────────────────────────────────────

const DB_CONFIG = getTestDBConfig();
const schemaPath = join(import.meta.dir, '..', 'fixtures', 'database-schema.sql');
const schemaExists = await Bun.file(schemaPath).exists();
const describeOrSkip = schemaExists ? describe : describe.skip;

const LIVE_PORT = 4291;
const SDL_PORT = 4292;
const LIVE_URL = `http://localhost:${LIVE_PORT}/graphql`;
const SDL_URL = `http://localhost:${SDL_PORT}/graphql`;

let liveServer: any;
let sdlServer: any;

async function setupDatabase() {
	try {
		const adminSql = new SQL(DB_CONFIG.maintenanceUrl);
		const safeDbName = DB_CONFIG.database.replace(/[^a-zA-Z0-9_]/g, '');
		await adminSql`CREATE DATABASE ${safeDbName}`;
		await adminSql.close();
	} catch {
		// already exists
	}

	sql = new SQL(DB_CONFIG.url);
	await sql`select 1`;

	try {
		await sql.file(schemaPath);
	} catch {
		// schema may already exist
	}

	await loadData();
}

async function loadData() {
	// Insert ALL tables in dependency order (same as main integration test)
	const insertOrder = [
		{ table: 'regions', data: AllSampleData.regions || [] },
		{ table: 'quests', data: AllSampleData.quests || [] },
		{ table: 'fellowships', data: AllSampleData.fellowships || [] },
		{ table: 'weapons', data: AllSampleData.weapons || [] },
		{ table: 'artifacts', data: AllSampleData.artifacts || [] },
		{ table: 'persons', data: AllSampleData.persons || [] },
		{ table: 'rings', data: AllSampleData.rings || [] },
		{ table: 'battles', data: AllSampleData.battles || [] },
		{ table: 'armies', data: AllSampleData.armies || [] },
		{ table: 'person_battles', data: AllSampleData.person_battles || [] },
		{ table: 'army_battles', data: AllSampleData.army_battles || [] },
	];

	for (const { table, data } of insertOrder) {
		if (data.length > 0) {
			try {
				await sql`INSERT INTO ${sql.unsafe(table)} ${sql(data)}`;
			} catch (e: any) {
				// data may already exist from main test suite
			}
		}
	}
}

async function buildLiveSchema() {
	return buildSchema({
		resolvers: [PersonResolver, RingResolver],
		validate: false,
	});
}

async function buildSDLRebuiltSchema() {
	const nativeSchema = await buildLiveSchema();
	// Extract resolvers from the live schema
	const resolvers = getResolversFromSchema(nativeSchema);
	// Print to SDL, rebuild from AST — this is the path that LOSES numeric
	// enum values. Then manually attach resolvers WITHOUT the enum type
	// mappings (simulating Apollo Server + buildResolverMapFromMetadata).
	// We strip the enum types from the resolver map to simulate a real
	// SDL-file-based deployment where enum values are not available.
	const sdl = printSchema(nativeSchema);
	const astSchema = buildASTSchema(parse(sdl));
	// Only pass Query/ObjectType resolvers — NOT enum type resolvers.
	// This mirrors the real-world Apollo Server + SDL file pattern where
	// the enum value mapping is lost.
	const { RingBearerStatus: _rbs, PersonRank: _pr, ...resolversWithoutEnums } = resolvers as any;
	return addResolversToSchema({ schema: astSchema, resolvers: resolversWithoutEnums });
}

function startServer(port: number, schema: any) {
	const yoga = createYoga({ schema });
	return Bun.serve({ port, fetch: yoga as any });
}

async function gql(url: string, query: string): Promise<any> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query }),
	});
	return response.json();
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describeOrSkip('mapNumericEnum output modes — live schema vs SDL-rebuilt', () => {
	beforeAll(async () => {
		// Default global: raw mode
		setGlobalConfig({ mapEnumOutput: 'raw' });

		await setupDatabase();
		metadataProvider = new DatabaseMetadataProvider(sql);
		queryManager = new GQLQueryManager({ namedParameterPrefix: ':' });

		const liveSchema = await buildLiveSchema();
		liveServer = startServer(LIVE_PORT, liveSchema);

		const sdlSchema = await buildSDLRebuiltSchema();
		sdlServer = startServer(SDL_PORT, sdlSchema);
	}, 30000);

	afterAll(async () => {
		setGlobalConfig({ mapEnumOutput: 'raw' });
		if (liveServer) liveServer.stop(true);
		if (sdlServer) sdlServer.stop(true);
		if (metadataProvider) await metadataProvider.close();
		if (sql) await sql.end();
	});

	// ── Live schema + raw mode ───────────────────────────────────────────────

	describe('live schema (mapEnumOutput=raw)', () => {
		beforeAll(() => setGlobalConfig({ mapEnumOutput: 'raw' }));

		it('should serialize enum values as string keys', async () => {
			const result = await gql(LIVE_URL, `{ rings { id name status } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(3);
			const statuses = result.data.rings.map((r: any) => r.status).sort();
			expect(statuses).toEqual(['Destroyed', 'Forged', 'Lost']);
		});

		it('should filter by enum string key', async () => {
			const result = await gql(
				LIVE_URL,
				`{ rings(filter: { status: Forged }) { id name status } }`
			);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(1);
			expect(result.data.rings[0].status).toBe('Forged');
			expect(result.data.rings[0].name).toContain('One Ring');
		});

		it('should filter by enum _in operator', async () => {
			const result = await gql(
				LIVE_URL,
				`{ rings(filter: { status_in: [Lost, Destroyed] }) { id status } }`
			);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(2);
		});

		it('should serialize rank as string key', async () => {
			const result = await gql(LIVE_URL, `{ persons(filter: { name: "Gandalf" }) { name rank } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.persons).toBeArrayOfSize(1);
			expect(result.data.persons[0].rank).toBe('Officer');
			expect(typeof result.data.persons[0].rank).toBe('string');
		});

		it('should filter persons by rank_eq', async () => {
			const result = await gql(LIVE_URL, `{ persons(filter: { rank_eq: Leader }) { name rank } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.persons).toBeArray();
			for (const p of result.data.persons) {
				expect(p.rank).toBe('Leader');
			}
		});
	});

	// ── SDL-rebuilt schema + key mode ────────────────────────────────────────

	describe('SDL-rebuilt schema (mapEnumOutput=key)', () => {
		beforeAll(() => setGlobalConfig({ mapEnumOutput: 'key' }));
		afterAll(() => setGlobalConfig({ mapEnumOutput: 'raw' }));

		it('should serialize enum values as string keys via CASE WHEN', async () => {
			const result = await gql(SDL_URL, `{ rings { id name status } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(3);
			const statuses = result.data.rings.map((r: any) => r.status).sort();
			expect(statuses).toEqual(['Destroyed', 'Forged', 'Lost']);
		});

		it('should filter by enum string key via CASE WHEN', async () => {
			const result = await gql(SDL_URL, `{ rings(filter: { status: Forged }) { id name status } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(1);
			expect(result.data.rings[0].status).toBe('Forged');
			expect(result.data.rings[0].name).toContain('One Ring');
		});

		it('should filter by enum _in operator via CASE WHEN', async () => {
			const result = await gql(
				SDL_URL,
				`{ rings(filter: { status_in: [Lost, Destroyed] }) { id status } }`
			);
			expect(result.errors).toBeUndefined();
			expect(result.data.rings).toBeArrayOfSize(2);
		});

		it('should serialize rank as string key via CASE WHEN', async () => {
			const result = await gql(SDL_URL, `{ persons(filter: { name: "Gandalf" }) { name rank } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.persons).toBeArrayOfSize(1);
			expect(result.data.persons[0].rank).toBe('Officer');
			expect(typeof result.data.persons[0].rank).toBe('string');
		});

		it('should filter persons by rank_eq via CASE WHEN', async () => {
			const result = await gql(SDL_URL, `{ persons(filter: { rank_eq: Leader }) { name rank } }`);
			expect(result.errors).toBeUndefined();
			expect(result.data.persons).toBeArray();
			for (const p of result.data.persons) {
				expect(p.rank).toBe('Leader');
			}
		});
	});
});
