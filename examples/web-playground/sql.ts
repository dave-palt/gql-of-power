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

// Database initialization
export async function initializeDatabase() {
	db.run(`CREATE TABLE regions (
		id SERIAL PRIMARY KEY,
		region_name TEXT NOT NULL,
		ruler_name TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`);

	// -- Quests (independent table)
	db.run(`CREATE TABLE quests (
    id SERIAL PRIMARY KEY,
    quest_name TEXT NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    success BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Fellowships (references quests - m:1)
	db.run(`CREATE TABLE fellowships (
    id SERIAL PRIMARY KEY,
    fellowship_name TEXT NOT NULL,
    purpose TEXT,
    formed_date DATE,
    disbanded BOOLEAN DEFAULT FALSE,
    quest_id INTEGER REFERENCES quests(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Persons (references fellowships - m:1)
	db.run(`CREATE TABLE persons (
    id SERIAL PRIMARY KEY,
    person_name TEXT NOT NULL,
    age INTEGER,
    race TEXT NOT NULL,
    home_location TEXT,
    ring_id INTEGER REFERENCES rings(id),
    fellowship_id INTEGER REFERENCES fellowships(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Rings (references persons as bearer - 1:1)
	db.run(`CREATE TABLE rings (
    id SERIAL PRIMARY KEY,
    ring_name TEXT NOT NULL,
    power_description TEXT,
    forged_by TEXT,
    bearer_id INTEGER UNIQUE REFERENCES persons(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Authors (independent table)
	db.run(`CREATE TABLE authors (
    id SERIAL PRIMARY KEY,
    author_name TEXT NOT NULL,
    birth_year INTEGER,
    nationality TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Genres (independent table)
	db.run(`CREATE TABLE genres (
    id SERIAL PRIMARY KEY,
    genre_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Books (references authors - m:1)
	db.run(`CREATE TABLE books (
    id SERIAL PRIMARY KEY,
    book_title TEXT NOT NULL,
    published_year INTEGER,
    page_count INTEGER,
    author_id INTEGER REFERENCES authors(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Locations (references regions - m:1)
	db.run(`CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    location_name TEXT NOT NULL,
    location_type TEXT,
    description TEXT,
    region_id INTEGER REFERENCES regions(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Battles (independent table, locations via m:m)
	db.run(`CREATE TABLE battles (
    id SERIAL PRIMARY KEY,
    battle_name TEXT NOT NULL,
    battle_date DATE,
    outcome TEXT,
    casualties INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Armies (independent table)
	db.run(`CREATE TABLE armies (
    id SERIAL PRIMARY KEY,
    army_name TEXT NOT NULL,
    army_size INTEGER,
    allegiance TEXT,
    leader_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Junction Tables for Many-to-Many relationships
	// -- Person <-> Battle (m:m)
	db.run(`CREATE TABLE person_battles (
		person_id INTEGER REFERENCES persons(id),
		battle_id INTEGER REFERENCES battles(id),
		--PRIMARY KEY (person_id, battle_id),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`);

	// -- Army <-> Battle (m:m)
	db.run(`CREATE TABLE army_battles (
    army_id INTEGER REFERENCES armies(id),
    battle_id INTEGER REFERENCES battles(id),
    --PRIMARY KEY (army_id, battle_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Book <-> Person (characters) (m:m)
	db.run(`CREATE TABLE book_characters (
    book_id INTEGER REFERENCES books(id),
    person_id INTEGER REFERENCES persons(id),
    --PRIMARY KEY (book_id, person_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Book <-> Genre (m:m)
	db.run(`CREATE TABLE book_genres (
    book_id INTEGER REFERENCES books(id),
    genre_id INTEGER REFERENCES genres(id),
    --PRIMARY KEY (book_id, genre_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Quest <-> Location (m:m)
	db.run(`CREATE TABLE quest_locations (
    quest_id INTEGER REFERENCES quests(id),
    location_id INTEGER REFERENCES locations(id),
    --PRIMARY KEY (quest_id, location_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- Battle <-> Location (m:m)
	db.run(`CREATE TABLE battle_locations (
    battle_id INTEGER REFERENCES battles(id),
    location_id INTEGER REFERENCES locations(id),
    --PRIMARY KEY (battle_id, location_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

	// -- db.run(`Create indexes for better query performance
	db.run(`CREATE INDEX idx_persons_fellowship_id ON persons(fellowship_id)`);

	db.run(`CREATE INDEX idx_persons_race ON persons(race)`);

	db.run(`CREATE INDEX idx_rings_bearer_id ON rings(bearer_id)`);

	db.run(`CREATE INDEX idx_books_author_id ON books(author_id)`);

	db.run(`CREATE INDEX idx_locations_region_id ON locations(region_id)`);

	db.run(`CREATE INDEX idx_fellowships_quest_id ON fellowships(quest_id)`);

	db.run(`CREATE INDEX idx_battle_locations_battle_id ON battle_locations(battle_id)`);

	db.run(`CREATE INDEX idx_battle_locations_location_id ON battle_locations(location_id)`);
}
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

export const insertSampleData = async () => {
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
				const query = knexInstance(table).insert(data);
				// console.log('query', query.toString());
				// Use Bun's idiomatic sql(record) syntax - works for both single records and arrays
				sql`${sql.unsafe(query.toString())}`;
			} catch (error) {
				console.error(`Error inserting into ${table}:`, error);
				console.error('Data:', data);
				throw error;
			}
		}
	}
};
