/**
 * Shared database configuration for integration tests.
 *
 * Resolves connection params from multiple sources in priority order so the
 * tests work in:
 *   - GitHub Actions (provides DATABASE_URL + POSTGRES_* env vars on a
 *     postgres:16-alpine service container)
 *   - Local dev (DATABASE_URL set, or DB_* / POSTGRES_* vars, or defaults)
 *
 * Usage:
 *   import { getTestDBConfig } from '../fixtures/test-db-config';
 *   const db = getTestDBConfig();
 *   const sql = new SQL(db.url);
 *
 * The CI service container pre-creates the database (POSTGRES_DB), so tests
 * connect directly. Locally, if the DB doesn't exist yet, the test's setup
 * may create it via a connection to the maintenance DB ('postgres').
 */
export type TestDBConfig = {
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	/** Connection URL for the test database. */
	url: string;
	/**
	 * Connection URL for the maintenance DB used to CREATE/DROP the test DB.
	 * Always points at 'postgres' on the same server. Only needed for local
	 * setup where the test DB may not exist yet.
	 */
	maintenanceUrl: string;
};

function env(key: string, fallback = ''): string {
	const v = process.env[key];
	return v === undefined || v === '' ? fallback : v;
}

export function getTestDBConfig(): TestDBConfig {
	// DATABASE_URL is the highest-priority source (set by CI and most local setups).
	// Format: postgresql://user:password@host:port/database
	const databaseUrl = env('DATABASE_URL');
	if (databaseUrl) {
		try {
			const parsed = new URL(databaseUrl);
			return {
				host: parsed.hostname || 'localhost',
				port: parsed.port ? parseInt(parsed.port) : 5432,
				database: parsed.pathname.replace(/^\//, '') || 'gql_of_power_test',
				username: parsed.username || 'postgres',
				password: parsed.password || '',
				url: databaseUrl,
				maintenanceUrl: `postgresql://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port}/postgres`,
			};
		} catch {
			// Malformed DATABASE_URL — fall through to env-var resolution below
		}
	}

	// CI provides POSTGRES_* vars; local may provide DB_* or POSTGRES_*.
	const host = env('POSTGRES_HOST') || env('DB_HOST', 'localhost');
	const port = parseInt(env('POSTGRES_PORT') || env('DB_PORT', '5432'));
	const database = env('POSTGRES_DB') || env('DB_NAME', 'gql_of_power_test');
	const username = env('POSTGRES_USER') || env('DB_USER', 'postgres');
	const password = env('POSTGRES_PASSWORD') || env('DB_PASSWORD', '');
	const url = `postgresql://${username}:${password}@${host}:${port}/${database}`;
	const maintenanceUrl = `postgresql://${username}:${password}@${host}:${port}/postgres`;

	return { host, port, database, username, password, url, maintenanceUrl };
}
