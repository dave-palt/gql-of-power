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
 * Mock data for testing GraphQL server integration
 */
const MockData = {
	persons: [
		{
			id: 1,
			person_name: 'Frodo Baggins',
			age: 50,
			race: 'Hobbit',
			home_location: 'Bag End, Shire',
			fellowship_id: 1,
		},
		{
			id: 2,
			person_name: 'Gandalf',
			age: 2019,
			race: 'Wizard',
			home_location: 'Valinor',
			fellowship_id: 1,
		},
		{
			id: 3,
			person_name: 'Aragorn',
			age: 87,
			race: 'Human',
			home_location: 'Gondor',
			fellowship_id: 1,
		},
		{
			id: 4,
			person_name: 'Legolas',
			age: 2931,
			race: 'Elf',
			home_location: 'Woodland Realm',
			fellowship_id: 1,
		},
		{
			id: 5,
			person_name: 'Gimli',
			age: 139,
			race: 'Dwarf',
			home_location: 'Erebor',
			fellowship_id: 1,
		},
		{
			id: 6,
			person_name: 'Boromir',
			age: 41,
			race: 'Human',
			home_location: 'Gondor',
			fellowship_id: 1,
		},
		{
			id: 7,
			person_name: 'Samwise Gamgee',
			age: 36,
			race: 'Hobbit',
			home_location: 'Bag End, Shire',
			fellowship_id: 1,
		},
		{
			id: 8,
			person_name: 'Meriadoc Brandybuck',
			age: 36,
			race: 'Hobbit',
			home_location: 'Buckland, Shire',
			fellowship_id: 1,
		},
		{
			id: 9,
			person_name: 'Peregrin Took',
			age: 28,
			race: 'Hobbit',
			home_location: 'Great Smials, Shire',
			fellowship_id: 1,
		},
	],
	rings: [
		{
			id: 1,
			ring_name: 'The One Ring',
			power_description: 'Controls all other Rings of Power',
			forged_by: 'Sauron',
			bearer_id: 1,
		},
		{
			id: 2,
			ring_name: 'Vilya',
			power_description: 'Ring of Air, mightiest of the Three',
			forged_by: 'Celebrimbor',
			bearer_id: 4,
		},
		{
			id: 3,
			ring_name: 'Narya',
			power_description: 'Ring of Fire',
			forged_by: 'Celebrimbor',
			bearer_id: 2,
		},
	],
	fellowships: [
		{
			id: 1,
			fellowship_name: 'Fellowship of the Ring',
			purpose: 'Destroy the One Ring',
			disbanded: false,
			quest_id: 1,
		},
		{
			id: 2,
			fellowship_name: 'White Council',
			purpose: 'Oppose the Shadow',
			disbanded: true,
			quest_id: null,
		},
	],
	battles: [
		{
			id: 1,
			battle_name: "Battle of Helm's Deep",
			battle_date: '2019-03-03',
			outcome: 'Victory',
			casualties: 50,
			location_id: 1,
		},
		{
			id: 2,
			battle_name: 'Battle of the Pelennor Fields',
			battle_date: '2019-03-15',
			outcome: 'Victory',
			casualties: 7000,
			location_id: 2,
		},
		{
			id: 3,
			battle_name: 'Battle of the Black Gate',
			battle_date: '2019-03-25',
			outcome: 'Victory',
			casualties: 1000,
			location_id: 3,
		},
	],
	// Junction tables for many-to-many relationships
	person_battles: [
		{ person_id: 1, battle_id: 2 }, // Frodo at Pelennor
		{ person_id: 2, battle_id: 1 }, // Gandalf at Helm's Deep
		{ person_id: 2, battle_id: 2 }, // Gandalf at Pelennor
		{ person_id: 2, battle_id: 3 }, // Gandalf at Black Gate
		{ person_id: 3, battle_id: 1 }, // Aragorn at Helm's Deep
		{ person_id: 3, battle_id: 2 }, // Aragorn at Pelennor
		{ person_id: 3, battle_id: 3 }, // Aragorn at Black Gate
		{ person_id: 4, battle_id: 1 }, // Legolas at Helm's Deep
		{ person_id: 4, battle_id: 2 }, // Legolas at Pelennor
		{ person_id: 5, battle_id: 1 }, // Gimli at Helm's Deep
		{ person_id: 5, battle_id: 2 }, // Gimli at Pelennor
	],
};

/**
 * Database MetadataProvider that can work with real PostgreSQL or mock data
 */
export class DatabaseMetadataProvider implements MetadataProvider {
	private metadata = new Map(Object.entries(DatabaseEntityMetadata));
	private mockData: any = {};
	private useMockData = false;

	constructor(
		private sql: SQL // Optional Bun's SQL connection
	) {}

	client = 'pg';

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

	/**
	 * Execute a query against the real database using named parameters
	 */
	/**
	 * Load mock data for testing without a database connection
	 */
	loadMockData = async (): Promise<void> => {
		console.log('📊 Loading mock data for testing...');
		this.mockData = { ...MockData };
		this.useMockData = true;
		console.log('✅ Mock data loaded successfully');
	};

	executeQuery = async (query: string, bindings?: any): Promise<any[]> => {
		console.log('🔍 Executing query:', query, bindings);
		// If using mock data, execute the query against the in-memory data
		if (this.useMockData) {
			return this.executeMockQuery(query, bindings);
		}

		// Otherwise use real database
		if (!this.sql) {
			throw new Error('No SQL connection provided and not using mock data');
		}

		const sql = this.sql;
		try {
			// Execute the query using Bun's SQL template with inline values (no parameters)
			const results = await sql`${sql.unsafe(query)}`;

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
	 * Execute a query against the mock data
	 */
	private executeMockQuery = (query: string, bindings?: any): Promise<any[]> => {
		console.log('🔍 Executing mock query:', query);
		console.log('📝 With bindings:', bindings);

		// Very simplified mock - just return the appropriate table data
		// For this integration test, we'll simplify and just return all data
		// with proper JSON structure that matches what the library expects

		let results: any[] = [];

		// Determine which table is being queried
		if (query.includes('persons')) {
			// Apply basic filtering if there's a race filter
			let persons = [...this.mockData.persons];

			if (bindings && bindings.e_race1_race) {
				persons = persons.filter((p) => p.race === bindings.e_race1_race);
			}
			if (bindings && bindings.e_id1_id) {
				persons = persons.filter((p) => p.id === bindings.e_id1_id);
			}

			// Transform to match expected JSON structure
			results = persons.map((person) => ({
				id: person.id,
				name: person.person_name, // Use the actual field name that was queried
				age: person.age,
				race: person.race,
				home: person.home_location,
				// Add relationships as null for now - in a real implementation
				// these would be resolved based on the query structure
				ring: null,
				fellowship: null,
				battles: null,
			}));
		} else if (query.includes('rings')) {
			results = this.mockData.rings.map((ring: any) => ({
				id: ring.id,
				name: ring.ring_name,
				power: ring.power_description,
				forgedBy: ring.forged_by,
				bearer: null,
			}));
		} else if (query.includes('fellowships')) {
			results = this.mockData.fellowships.map((fellowship: any) => ({
				id: fellowship.id,
				name: fellowship.fellowship_name,
				purpose: fellowship.purpose,
				disbanded: fellowship.disbanded,
				members: null,
			}));
		} else if (query.includes('battles')) {
			results = this.mockData.battles.map((battle: any) => ({
				id: battle.id,
				name: battle.battle_name,
				outcome: battle.outcome,
				casualties: battle.casualties,
				warriors: null,
			}));
		} else {
			// Default empty result
			results = [];
		}

		console.log('✅ Mock query executed, rows returned:', results.length);
		console.log('Sample result:', results[0]);
		return Promise.resolve(results);
	};

	/**
	 * Close the database connection
	 */
	close = async (): Promise<void> => {
		if (this.useMockData) {
			// No need to close anything for mock data
			return;
		}

		if (this.sql && typeof this.sql.end === 'function') {
			await this.sql.end();
		}
	};
}
