/**
 * Database MetadataProvider for Integration Tests
 *
 * This provider works with real PostgreSQL database using Bun's native database support.
 * It provides metadata for all Middle-earth entities matching the database schema.
 */

import { SQL } from 'bun';
import { EntityMetadata, MetadataProvider } from '../../src/types';

// Database connection interface for PostgreSQL
interface PostgreSQLDatabase {
	query<T = any>(sql: string, params?: any[]): Promise<T[]>;
	prepare(sql: string): {
		all<T = any>(params?: any[]): Promise<T[]>;
		run(params?: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
	};
	close(): void;
}

/**
 * Real database metadata matching the SQL schema
 */
export const DatabaseEntityMetadata: Record<string, EntityMetadata<any>> = {
	Person: {
		name: 'Person',
		tableName: 'persons',
		primaryKeys: ['id'],
		properties: {
			id: {
				type: 'number',
				name: 'id',
				fieldNames: ['id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			name: {
				type: 'string',
				name: 'name',
				fieldNames: ['person_name'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			age: {
				type: 'number',
				name: 'age',
				fieldNames: ['age'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			race: {
				type: 'string',
				name: 'race',
				fieldNames: ['race'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			home: {
				type: 'string',
				name: 'home',
				fieldNames: ['home_location'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			// 1:1 relationship - Person has one Ring (via bearer_id on rings table)
			ring: {
				type: 'Ring',
				name: 'ring',
				fieldNames: [],
				mappedBy: 'bearer',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: '1:1',
			},
			// m:1 relationship - Person belongs to one Fellowship
			fellowshipId: {
				type: 'number',
				name: 'fellowshipId',
				fieldNames: ['fellowship_id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			fellowship: {
				type: 'Fellowship',
				name: 'fellowship',
				fieldNames: ['fellowship_id'],
				mappedBy: '',
				joinColumns: ['fellowship_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: 'm:1',
			},
			// m:m relationship - Person participates in many Battles
			battles: {
				type: 'Battle',
				name: 'battles',
				fieldNames: [],
				mappedBy: '',
				joinColumns: ['person_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: ['battle_id'],
				pivotTable: 'person_battles',
				reference: 'm:n',
			},
			// m:m relationship - Person appears in many Books
			books: {
				type: 'Book',
				name: 'books',
				fieldNames: [],
				mappedBy: '',
				joinColumns: ['person_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: ['book_id'],
				pivotTable: 'book_characters',
				reference: 'm:n',
			},
		},
	},

	Ring: {
		name: 'Ring',
		tableName: 'rings',
		primaryKeys: ['id'],
		properties: {
			id: {
				type: 'number',
				name: 'id',
				fieldNames: ['id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			name: {
				type: 'string',
				name: 'name',
				fieldNames: ['ring_name'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			power: {
				type: 'string',
				name: 'power',
				fieldNames: ['power_description'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			forgedBy: {
				type: 'string',
				name: 'forgedBy',
				fieldNames: ['forged_by'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			// 1:1 relationship - Ring has one bearer (Person)
			bearerId: {
				type: 'number',
				name: 'bearerId',
				fieldNames: ['bearer_id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			bearer: {
				type: 'Person',
				name: 'bearer',
				fieldNames: ['bearer_id'],
				mappedBy: '',
				joinColumns: ['bearer_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: 'm:1',
			},
		},
	},

	Fellowship: {
		name: 'Fellowship',
		tableName: 'fellowships',
		primaryKeys: ['id'],
		properties: {
			id: {
				type: 'number',
				name: 'id',
				fieldNames: ['id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			name: {
				type: 'string',
				name: 'name',
				fieldNames: ['fellowship_name'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			purpose: {
				type: 'string',
				name: 'purpose',
				fieldNames: ['purpose'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			disbanded: {
				type: 'boolean',
				name: 'disbanded',
				fieldNames: ['disbanded'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			// 1:m relationship - Fellowship has many members (Person)
			members: {
				type: 'Person',
				name: 'members',
				fieldNames: [],
				mappedBy: 'fellowship',
				joinColumns: ['id'],
				referencedColumnNames: ['fellowship_id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: '1:m',
			},
			// m:1 relationship - Fellowship belongs to one Quest
			questId: {
				type: 'number',
				name: 'questId',
				fieldNames: ['quest_id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			quest: {
				type: 'Quest',
				name: 'quest',
				fieldNames: ['quest_id'],
				mappedBy: '',
				joinColumns: ['quest_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: 'm:1',
			},
		},
	},

	Quest: {
		name: 'Quest',
		tableName: 'quests',
		primaryKeys: ['id'],
		properties: {
			id: {
				type: 'number',
				name: 'id',
				fieldNames: ['id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			name: {
				type: 'string',
				name: 'name',
				fieldNames: ['quest_name'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			description: {
				type: 'string',
				name: 'description',
				fieldNames: ['description'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			success: {
				type: 'boolean',
				name: 'success',
				fieldNames: ['success'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			// 1:m relationship - Quest can have many Fellowships
			fellowships: {
				type: 'Fellowship',
				name: 'fellowships',
				fieldNames: [],
				mappedBy: 'quest',
				joinColumns: ['id'],
				referencedColumnNames: ['quest_id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: '1:m',
			},
			// m:m relationship - Quest involves many Locations
			locations: {
				type: 'Location',
				name: 'locations',
				fieldNames: [],
				mappedBy: '',
				joinColumns: ['quest_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: ['location_id'],
				pivotTable: 'quest_locations',
				reference: 'm:n',
			},
		},
	},

	Battle: {
		name: 'Battle',
		tableName: 'battles',
		primaryKeys: ['id'],
		properties: {
			id: {
				type: 'number',
				name: 'id',
				fieldNames: ['id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			name: {
				type: 'string',
				name: 'name',
				fieldNames: ['battle_name'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			date: {
				type: 'string',
				name: 'date',
				fieldNames: ['battle_date'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			outcome: {
				type: 'string',
				name: 'outcome',
				fieldNames: ['outcome'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			casualties: {
				type: 'number',
				name: 'casualties',
				fieldNames: ['casualties'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			// m:m relationship - Battle involves many warriors (Person)
			warriors: {
				type: 'Person',
				name: 'warriors',
				fieldNames: [],
				mappedBy: 'battles',
				joinColumns: ['battle_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: ['person_id'],
				pivotTable: 'person_battles',
				reference: 'm:n',
			},
			// m:1 relationship - Battle happens at one Location
			locationId: {
				type: 'number',
				name: 'locationId',
				fieldNames: ['location_id'],
				mappedBy: '',
				joinColumns: [],
				referencedColumnNames: [],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: undefined,
			},
			location: {
				type: 'Location',
				name: 'location',
				fieldNames: ['location_id'],
				mappedBy: '',
				joinColumns: ['location_id'],
				referencedColumnNames: ['id'],
				inverseJoinColumns: [],
				pivotTable: '',
				reference: 'm:1',
			},
		},
	},
};

/**
 * Database MetadataProvider that connects to real PostgreSQL using Bun
 */
export class DatabaseMetadataProvider implements MetadataProvider {
	private metadata = new Map(Object.entries(DatabaseEntityMetadata));

	constructor(
		private sql: SQL // Bun's SQL connection
	) {}

	exists = (entityName: string): boolean => {
		return this.metadata.has(entityName);
	};

	getMetadata = <T, K extends any>(entityName: string): K => {
		const meta = this.metadata.get(entityName);
		if (!meta) {
			throw new Error(`Entity metadata not found for: ${entityName}`);
		}
		return meta as K;
	};

	rawQuery = (sql: string, bindings?: any): string => {
		console.log('Raw SQL Query:', sql);
		console.log('With bindings:', bindings);
		// Note: This method just returns the SQL string with named parameters
		// It does not execute the query. Use executeQuery for that.
		// For debugging/logging - show SQL as-is with named parameters
		// The actual parameter binding will be handled by Bun's PostgreSQL driver
		return sql;
	};

	/**
	 * Execute a query against the real database using named parameters
	 */
	executeQuery = async (query: string, bindings?: any): Promise<any[]> => {
		const sql = this.sql;
		try {
			console.log('🔍 Executing SQL:', query);
			console.log('📝 With bindings:', bindings);

			const _query = this.formatQueryWithBindings(bindings, query);

			console.log('📝 Compiled query:', _query);
			// Execute the query using Bun's SQL template with named parameters
			const results = await sql`${sql.unsafe(_query)}`.simple();

			console.log('✅ Query executed, rows returned:', results?.length || 0);

			return results || [];
		} catch (error) {
			console.error('❌ Database query failed:', error);
			console.error('🔍 Failed SQL:', query);
			console.error('📝 Failed bindings:', bindings);
			throw error;
		}
	};

	/**
	 * Execute a prepared statement with named parameters
	 */
	executePreparedQuery = async (query: string, bindings?: any): Promise<any[]> => {
		const sql = this.sql;
		try {
			const _query = this.formatQueryWithBindings(bindings, query);

			console.log('📝 Compiled prepared query:', _query);
			// Use prepared statement with SQL template
			const results = await sql`${sql.unsafe(_query)}`.simple();
			return results || [];
		} catch (error) {
			console.error('❌ Prepared query failed:', error);
			throw error;
		}
	};

	/**
	 * Close the database connection
	 */
	close = async (): Promise<void> => {
		if (this.sql && typeof this.sql.end === 'function') {
			await this.sql.end();
		}
	};

	private formatQueryWithBindings(bindings: any, query: string) {
		return Object.keys(bindings || {}).reduce((query, key) => {
			const value = bindings[key];
			const formattedValue = this.convertValueToSQL(value);
			return query.replaceAll(new RegExp(`\\$${key}\\b`, 'gi'), formattedValue);
		}, query);
	}

	private convertValueToSQL(value: any): string {
		return value === null || value === undefined
			? 'NULL'
			: Array.isArray(value)
			? `(${value.map((v) => this.convertValueToSQL(v)).join(',')})`
			: typeof value === 'string'
			? `'${value.replace(/'/g, "''")}'`
			: typeof value === 'object'
			? 'toISOString' in value
				? `'${value.toISOString()}'`
				: `'${value.toString()}'`
			: `${value}`;
	}
}
