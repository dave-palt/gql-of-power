/**
 * Test Data Fixtures for Middle-earth Schema
 *
 * This file contains sample data for all entities and a mock metadata provider
 * that can be used for testing without requiring a real database connection.
 */

import { MetadataProvider } from '../../src/types';
import { AllEntityMetadata } from './middle-earth-schema';

// Sample data for testing
export const SamplePersons = [
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
		age: null, // Immortal
		race: 'Wizard',
		home_location: null,
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
		age: 500,
		race: 'Elf',
		home_location: 'Mirkwood',
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
		age: 38,
		race: 'Hobbit',
		home_location: 'Hobbiton, Shire',
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
		home_location: 'Tookland, Shire',
		fellowship_id: 1,
	},
	{
		id: 10,
		person_name: 'Sauron',
		age: null,
		race: 'Maia',
		home_location: 'Mordor',
		ring_id: 2,
		fellowship_id: null,
	},
];

export const SampleRings = [
	{
		id: 1,
		ring_name: 'The One Ring',
		power_description: 'Controls all other Rings of Power',
		forged_by: 'Sauron',
		bearer_id: 1,
	},
	{
		id: 2,
		ring_name: 'The Master Ring',
		power_description: 'Ultimate power over Middle-earth',
		forged_by: 'Sauron',
		bearer_id: 10,
	},
	{
		id: 3,
		ring_name: 'Vilya',
		power_description: 'Ring of Air, mightiest of the Three',
		forged_by: 'Celebrimbor',
		bearer_id: null,
	},
];

export const SampleFellowships = [
	{
		id: 1,
		fellowship_name: 'Fellowship of the Ring',
		purpose: 'Destroy the One Ring',
		formed_date: new Date('3018-12-25').toISOString(),
		disbanded: true,
		quest_id: 1,
	},
	{
		id: 2,
		fellowship_name: 'The White Council',
		purpose: 'Oppose the Shadow',
		formed_date: new Date('2953-01-01').toISOString(),
		disbanded: false,
		quest_id: 2,
	},
];

export const SampleQuests = [
	{
		id: 1,
		quest_name: 'Destroy the One Ring',
		description: 'Journey to Mount Doom to destroy the One Ring',
		start_date: new Date('3018-12-25').toISOString(),
		end_date: new Date('3019-03-25').toISOString(),
		success: true,
	},
	{
		id: 2,
		quest_name: 'Defeat the Necromancer',
		description: 'Drive the dark power from Dol Guldur',
		start_date: new Date('2941-01-01').toISOString(),
		end_date: new Date('2941-12-31').toISOString(),
		success: true,
	},
];

export const SampleRegions = [
	{
		id: 1,
		region_name: 'Gondor',
		ruler_name: 'Aragorn (Elessar)',
	},
	{
		id: 2,
		region_name: 'Rohan',
		ruler_name: 'Éomer',
	},
	{
		id: 3,
		region_name: 'The Shire',
		ruler_name: 'The Mayor (Sam Gamgee)',
	},
	{
		id: 4,
		region_name: 'Mordor',
		ruler_name: 'Sauron',
	},
];

export const SampleLocations = [
	{
		id: 1,
		location_name: 'Minas Tirith',
		location_type: 'City',
		description: 'The White City, capital of Gondor',
		region_id: 1,
	},
	{
		id: 2,
		location_name: 'Edoras',
		location_type: 'City',
		description: 'Capital city of Rohan',
		region_id: 2,
	},
	{
		id: 3,
		location_name: 'Hobbiton',
		location_type: 'Village',
		description: 'Village in the Shire where hobbits live',
		region_id: 3,
	},
	{
		id: 4,
		location_name: 'Mount Doom',
		location_type: 'Mountain',
		description: 'Volcano where the One Ring was forged',
		region_id: 4,
	},
	{
		id: 5,
		location_name: "Helm's Deep",
		location_type: 'Fortress',
		description: 'Ancient fortress in Rohan',
		region_id: 2,
	},
];

export const SampleBattles = [
	{
		id: 1,
		battle_name: "Battle of Helm's Deep",
		battle_date: new Date('3019-03-03').toISOString(),
		outcome: 'Victory',
		casualties: 500,
	},
	{
		id: 2,
		battle_name: 'Battle of the Pelennor Fields',
		battle_date: new Date('3019-03-15').toISOString(),
		outcome: 'Victory',
		casualties: 7000,
	},
	{
		id: 3,
		battle_name: 'Battle of the Black Gate',
		battle_date: new Date('3019-03-25').toISOString(),
		outcome: 'Victory',
		casualties: 1000,
	},
];

export const SampleArmies = [
	{
		id: 1,
		army_name: 'Army of Gondor',
		army_size: 7000,
		allegiance: 'Good',
		leader_name: 'Prince Imrahil',
	},
	{
		id: 2,
		army_name: 'Rohirrim',
		army_size: 6000,
		allegiance: 'Good',
		leader_name: 'Théoden',
	},
	{
		id: 3,
		army_name: 'Orcs of Isengard',
		army_size: 10000,
		allegiance: 'Evil',
		leader_name: 'Saruman',
	},
	{
		id: 4,
		army_name: 'Army of Mordor',
		army_size: 200000,
		allegiance: 'Evil',
		leader_name: 'The Mouth of Sauron',
	},
];

export const SampleAuthors = [
	{
		id: 1,
		author_name: 'J.R.R. Tolkien',
		birth_year: 1892,
		nationality: 'British',
	},
	{
		id: 2,
		author_name: 'Christopher Tolkien',
		birth_year: 1924,
		nationality: 'British',
	},
];

export const SampleBooks = [
	{
		id: 1,
		book_title: 'The Fellowship of the Ring',
		published_year: 1954,
		page_count: 423,
		author_id: 1,
	},
	{
		id: 2,
		book_title: 'The Two Towers',
		published_year: 1954,
		page_count: 352,
		author_id: 1,
	},
	{
		id: 3,
		book_title: 'The Return of the King',
		published_year: 1955,
		page_count: 416,
		author_id: 1,
	},
	{
		id: 4,
		book_title: 'The Silmarillion',
		published_year: 1977,
		page_count: 365,
		author_id: 2,
	},
];

export const SampleGenres = [
	{
		id: 1,
		genre_name: 'Fantasy',
		description: 'Stories with magical and supernatural elements',
	},
	{
		id: 2,
		genre_name: 'Epic',
		description: 'Large-scale adventures with heroic themes',
	},
	{
		id: 3,
		genre_name: 'Adventure',
		description: 'Action-packed journeys and quests',
	},
];

// Junction table data for many-to-many relationships
export const SamplePersonBattles = [
	{ person_id: 3, battle_id: 1 }, // Aragorn in Battle of Helm's Deep
	{ person_id: 3, battle_id: 2 }, // Aragorn in Battle of Pelennor Fields
	{ person_id: 3, battle_id: 3 }, // Aragorn in Battle of Black Gate
	{ person_id: 4, battle_id: 1 }, // Legolas in Battle of Helm's Deep
	{ person_id: 4, battle_id: 2 }, // Legolas in Battle of Pelennor Fields
	{ person_id: 5, battle_id: 1 }, // Gimli in Battle of Helm's Deep
	{ person_id: 5, battle_id: 2 }, // Gimli in Battle of Pelennor Fields
	{ person_id: 2, battle_id: 2 }, // Gandalf in Battle of Pelennor Fields
];

export const SampleArmyBattles = [
	{ army_id: 1, battle_id: 2 }, // Army of Gondor in Pelennor Fields
	{ army_id: 2, battle_id: 1 }, // Rohirrim in Helm's Deep
	{ army_id: 2, battle_id: 2 }, // Rohirrim in Pelennor Fields
	{ army_id: 3, battle_id: 1 }, // Orcs of Isengard in Helm's Deep
	{ army_id: 4, battle_id: 2 }, // Army of Mordor in Pelennor Fields
	{ army_id: 4, battle_id: 3 }, // Army of Mordor in Black Gate
];

export const SampleBookCharacters = [
	{ book_id: 1, person_id: 1 }, // Frodo in Fellowship
	{ book_id: 1, person_id: 2 }, // Gandalf in Fellowship
	{ book_id: 1, person_id: 3 }, // Aragorn in Fellowship
	{ book_id: 1, person_id: 7 }, // Sam in Fellowship
	{ book_id: 2, person_id: 1 }, // Frodo in Two Towers
	{ book_id: 2, person_id: 7 }, // Sam in Two Towers
	{ book_id: 3, person_id: 3 }, // Aragorn in Return of the King
];

export const SampleBookGenres = [
	{ book_id: 1, genre_id: 1 }, // Fellowship -> Fantasy
	{ book_id: 1, genre_id: 2 }, // Fellowship -> Epic
	{ book_id: 1, genre_id: 3 }, // Fellowship -> Adventure
	{ book_id: 2, genre_id: 1 }, // Two Towers -> Fantasy
	{ book_id: 2, genre_id: 2 }, // Two Towers -> Epic
	{ book_id: 3, genre_id: 1 }, // Return of the King -> Fantasy
	{ book_id: 3, genre_id: 2 }, // Return of the King -> Epic
];

export const SampleQuestLocations = [
	{ quest_id: 1, location_id: 3 }, // Ring Quest -> Hobbiton
	{ quest_id: 1, location_id: 4 }, // Ring Quest -> Mount Doom
	{ quest_id: 1, location_id: 1 }, // Ring Quest -> Minas Tirith
];

// All sample data in one place for easy access
export const AllSampleData = {
	persons: SamplePersons,
	rings: SampleRings,
	fellowships: SampleFellowships,
	quests: SampleQuests,
	regions: SampleRegions,
	locations: SampleLocations,
	battles: SampleBattles,
	armies: SampleArmies,
	authors: SampleAuthors,
	books: SampleBooks,
	genres: SampleGenres,
	// Junction tables
	person_battles: SamplePersonBattles,
	army_battles: SampleArmyBattles,
	book_characters: SampleBookCharacters,
	book_genres: SampleBookGenres,
	quest_locations: SampleQuestLocations,
};

/**
 * Mock MetadataProvider for testing
 * This provides all the necessary metadata without requiring a real ORM connection
 */
export class MockMetadataProvider implements MetadataProvider {
	private metadata = new Map(Object.entries(AllEntityMetadata));
	private queryResults = new Map<string, any[]>();

	constructor() {
		// Pre-populate with sample data
		Object.entries(AllSampleData).forEach(([tableName, data]) => {
			this.queryResults.set(tableName, data);
		});
	}

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
		// In a real implementation, this would apply bindings to the SQL
		// For testing, we'll just return the SQL with a simple placeholder replacement
		if (!bindings) return sql;

		let processedSql = sql;
		Object.entries(bindings).forEach(([key, value]) => {
			const placeholder = new RegExp(`:${key}\\b`, 'g');
			const sqlValue =
				value === null ? 'NULL' : typeof value === 'string' ? `'${value}'` : String(value);
			processedSql = processedSql.replace(placeholder, sqlValue);
		});

		return processedSql;
	};

	executeQuery = async (sql: string, params?: any[]): Promise<any> => {
		// Mock query execution
		// In a real test environment, you might want to use an in-memory database
		// For now, we'll return mock data based on the query pattern

		console.log('Mock executing query:', sql);
		console.log('With params:', params);

		// Return mock results based on the table being queried
		if (sql.includes('persons')) {
			return SamplePersons.map((person) => ({ val: person }));
		}
		if (sql.includes('rings')) {
			return SampleRings.map((ring) => ({ val: ring }));
		}
		if (sql.includes('fellowships')) {
			return SampleFellowships.map((fellowship) => ({ val: fellowship }));
		}

		// Default return for testing
		return [{ val: { id: 1, name: 'Mock Result' } }];
	};

	// Additional helper methods for testing
	setMockQueryResult = (sql: string, result: any[]): void => {
		this.queryResults.set(sql, result);
	};

	clearMockData = (): void => {
		this.queryResults.clear();
	};

	addMockData = (tableName: string, data: any[]): void => {
		this.queryResults.set(tableName, data);
	};
}

/**
 * Factory function to create a fresh MockMetadataProvider for each test
 */
export const createMockMetadataProvider = (): MockMetadataProvider => {
	return new MockMetadataProvider();
};

/**
 * Helper function to get sample data by entity name
 */
export const getSampleDataFor = (entityName: string): any[] => {
	const tableName = AllEntityMetadata[entityName as keyof typeof AllEntityMetadata]?.tableName;
	if (!tableName) {
		throw new Error(`No sample data found for entity: ${entityName}`);
	}

	return AllSampleData[tableName as keyof typeof AllSampleData] || [];
};
