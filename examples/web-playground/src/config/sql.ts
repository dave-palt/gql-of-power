import { SQL } from 'bun';
import knex from 'knex';

const DB_CONFIG = {
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '5432'),
	database: 'gql_of_power_test',
	username: process.env.DB_USER || 'postgres',
	password: process.env.DB_PASSWORD || '',
	url: () =>
		process.env.DATABASE_URL ||
		`postgresql://${DB_CONFIG.username || 'postgres'}:${DB_CONFIG.password || ''}@${
			DB_CONFIG.host || 'localhost'
		}:${DB_CONFIG.port || '5432'}/${DB_CONFIG.database || 'gql_of_power_test'}`,
};

// Database setup
// export const db = new Database(':memory:');
// export const sql = db.query.bind(db);
export const sql = new SQL(DB_CONFIG.url());
// Knex instance for parameter binding
export const knexInstance = knex({
	client: 'pg',
	// connection: ':memory:',
	// useNullAsDefault: true,
});
await sql`select 1`;
console.log('Knex initialized for SQLite in-memory database.');
// Initialize database with sample data
