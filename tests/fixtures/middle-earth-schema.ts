/**
 * Middle-earth Schema for Testing
 *
 * This file defines a comprehensive schema based on Lord of the Rings lore
 * covering all relationship types that the GQL-to-SQL mapper needs to handle:
 * - 1:1 relationships (Person <-> Ring)
 * - 1:m relationships (Fellowship -> Members, Region -> Locations)
 * - m:1 relationships (Books -> Author, Members -> Fellowship)
 * - m:m relationships (Battles <-> Warriors, Books <-> Genres)
 */

import { EntityMetadata, EntityProperty, ReferenceType } from '../../src/types';

// Entity Classes
export class Person {
	id!: number;
	name!: string;
	age?: number;
	race!: string; // Hobbit, Elf, Dwarf, Human, Wizard, etc.
	home?: string;
	// 1:1 relationship
	ring?: Ring;
	// m:1 relationship
	fellowshipId?: number;
	fellowship?: Fellowship;
	// m:m relationships
	battles?: Battle[];
	books?: Book[];
}

export class Ring {
	id!: number;
	name!: string;
	power!: string;
	forgedBy?: string;
	// 1:1 relationship
	bearerId?: number;
	bearer?: Person;
}

export class Fellowship {
	id!: number;
	name!: string;
	purpose!: string;
	formedDate?: Date;
	disbanded?: boolean;
	// 1:m relationship
	members?: Person[];
	// m:1 relationship
	questId?: number;
	quest?: Quest;
}

export class Quest {
	id!: number;
	name!: string;
	description!: string;
	startDate?: Date;
	endDate?: Date;
	success?: boolean;
	// 1:m relationship
	fellowships?: Fellowship[];
	// m:m relationship
	locations?: Location[];
}

export class Location {
	id!: number;
	name!: string;
	type!: string; // City, Mountain, Forest, etc.
	description?: string;
	// m:1 relationship
	regionId?: number;
	region?: Region;
	// m:m relationships
	quests?: Quest[];
	battles?: Battle[];
}

export class Region {
	id!: number;
	name!: string; // Gondor, Rohan, Shire, etc.
	ruler?: string;
	// 1:m relationship
	locations?: Location[];
}

export class Battle {
	id!: number;
	name!: string;
	date?: Date;
	outcome?: string; // Victory, Defeat, Draw
	casualties?: number;
	// m:1 relationship
	locationId?: number;
	location?: Location;
	// m:m relationships
	warriors?: Person[];
	armies?: Army[];
}

export class Army {
	id!: number;
	name!: string;
	size?: number;
	allegiance!: string; // Good, Evil, Neutral
	leader?: string;
	// m:m relationship
	battles?: Battle[];
}

export class Book {
	id!: number;
	title!: string;
	publishedYear?: number;
	pages?: number;
	// m:1 relationship
	authorId?: number;
	author?: Author;
	// m:m relationships
	characters?: Person[];
	genres?: Genre[];
}

export class Author {
	id!: number;
	name!: string;
	birthYear?: number;
	nationality?: string;
	// 1:m relationship
	books?: Book[];
}

export class Genre {
	id!: number;
	name!: string;
	description?: string;
	// m:m relationship
	books?: Book[];
}

// Helper function to create entity property
const createProperty = (
	type: string,
	name: string,
	fieldNames: string[],
	reference?: {
		referenceType: ReferenceType;
		joinColumns?: string[];
		referencedColumnNames?: string[];
		inverseJoinColumns?: string[];
		pivotTable?: string;
		mappedBy?: string;
	}
): EntityProperty => ({
	type,
	name,
	fieldNames,
	mappedBy: reference?.mappedBy || '',
	joinColumns: reference?.joinColumns || [],
	referencedColumnNames: reference?.referencedColumnNames || [],
	inverseJoinColumns: reference?.inverseJoinColumns || [],
	pivotTable: reference?.pivotTable || '',
	reference: reference?.referenceType,
});

// Entity Metadata Definitions
export const PersonMetadata: EntityMetadata<Person> = {
	name: 'Person',
	tableName: 'persons',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['person_name']),
		age: createProperty('number', 'age', ['age']),
		race: createProperty('string', 'race', ['race']),
		home: createProperty('string', 'home', ['home_location']),
		ring: createProperty('Ring', 'ring', [], {
			referenceType: ReferenceType.ONE_TO_ONE,
			mappedBy: 'bearer',
		}),
		fellowshipId: createProperty('number', 'fellowshipId', ['fellowship_id']),
		fellowship: createProperty('Fellowship', 'fellowship', ['fellowship_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['fellowship_id'],
			referencedColumnNames: ['id'],
		}),
		battles: createProperty('Battle', 'battles', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'person_battles',
			joinColumns: ['person_id'],
			inverseJoinColumns: ['battle_id'],
			referencedColumnNames: ['id'],
		}),
		books: createProperty('Book', 'books', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'book_characters',
			joinColumns: ['person_id'],
			inverseJoinColumns: ['book_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const RingMetadata: EntityMetadata<Ring> = {
	name: 'Ring',
	tableName: 'rings',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['ring_name']),
		power: createProperty('string', 'power', ['power_description']),
		forgedBy: createProperty('string', 'forgedBy', ['forged_by']),
		bearerId: createProperty('number', 'bearerId', ['bearer_id']),
		bearer: createProperty('Person', 'bearer', ['bearer_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['bearer_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const FellowshipMetadata: EntityMetadata<Fellowship> = {
	name: 'Fellowship',
	tableName: 'fellowships',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['fellowship_name']),
		purpose: createProperty('string', 'purpose', ['purpose']),
		formedDate: createProperty('Date', 'formedDate', ['formed_date']),
		disbanded: createProperty('boolean', 'disbanded', ['disbanded']),
		members: createProperty('Person', 'members', [], {
			referenceType: ReferenceType.ONE_TO_MANY,
			mappedBy: 'fellowship',
		}),
		questId: createProperty('number', 'questId', ['quest_id']),
		quest: createProperty('Quest', 'quest', ['quest_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['quest_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const QuestMetadata: EntityMetadata<Quest> = {
	name: 'Quest',
	tableName: 'quests',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['quest_name']),
		description: createProperty('string', 'description', ['description']),
		startDate: createProperty('Date', 'startDate', ['start_date']),
		endDate: createProperty('Date', 'endDate', ['end_date']),
		success: createProperty('boolean', 'success', ['success']),
		fellowship: createProperty('Fellowship', 'fellowships', [], {
			referenceType: ReferenceType.ONE_TO_MANY,
			mappedBy: 'quest',
		}),
		locations: createProperty('Location', 'locations', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'quest_locations',
			joinColumns: ['quest_id'],
			inverseJoinColumns: ['location_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const LocationMetadata: EntityMetadata<Location> = {
	name: 'Location',
	tableName: 'locations',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['location_name']),
		type: createProperty('string', 'type', ['location_type']),
		description: createProperty('string', 'description', ['description']),
		regionId: createProperty('number', 'regionId', ['region_id']),
		region: createProperty('Region', 'region', ['region_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['region_id'],
			referencedColumnNames: ['id'],
		}),
		quests: createProperty('Quest', 'quests', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'quest_locations',
			joinColumns: ['location_id'],
			inverseJoinColumns: ['quest_id'],
			referencedColumnNames: ['id'],
		}),
		battles: createProperty('Battle', 'battles', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'battle_locations',
			joinColumns: ['location_id'],
			inverseJoinColumns: ['battle_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const RegionMetadata: EntityMetadata<Region> = {
	name: 'Region',
	tableName: 'regions',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['region_name']),
		ruler: createProperty('string', 'ruler', ['ruler_name']),
		locations: createProperty('Location', 'locations', [], {
			referenceType: ReferenceType.ONE_TO_MANY,
			mappedBy: 'region',
		}),
	},
};

export const BattleMetadata: EntityMetadata<Battle> = {
	name: 'Battle',
	tableName: 'battles',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['battle_name']),
		date: createProperty('Date', 'date', ['battle_date']),
		outcome: createProperty('string', 'outcome', ['outcome']),
		casualties: createProperty('number', 'casualties', ['casualties']),
		locationId: createProperty('number', 'locationId', ['location_id']),
		location: createProperty('Location', 'location', ['location_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['location_id'],
			referencedColumnNames: ['id'],
		}),
		warriors: createProperty('Person', 'warriors', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'person_battles',
			joinColumns: ['battle_id'],
			inverseJoinColumns: ['person_id'],
			referencedColumnNames: ['id'],
		}),
		armies: createProperty('Army', 'armies', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'army_battles',
			joinColumns: ['battle_id'],
			inverseJoinColumns: ['army_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const ArmyMetadata: EntityMetadata<Army> = {
	name: 'Army',
	tableName: 'armies',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['army_name']),
		size: createProperty('number', 'size', ['army_size']),
		allegiance: createProperty('string', 'allegiance', ['allegiance']),
		leader: createProperty('string', 'leader', ['leader_name']),
		battles: createProperty('Battle', 'battles', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'army_battles',
			joinColumns: ['army_id'],
			inverseJoinColumns: ['battle_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const BookMetadata: EntityMetadata<Book> = {
	name: 'Book',
	tableName: 'books',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		title: createProperty('string', 'title', ['book_title']),
		publishedYear: createProperty('number', 'publishedYear', ['published_year']),
		pages: createProperty('number', 'pages', ['page_count']),
		authorId: createProperty('number', 'authorId', ['author_id']),
		author: createProperty('Author', 'author', ['author_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
			joinColumns: ['author_id'],
			referencedColumnNames: ['id'],
		}),
		characters: createProperty('Person', 'characters', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'book_characters',
			joinColumns: ['book_id'],
			inverseJoinColumns: ['person_id'],
			referencedColumnNames: ['id'],
		}),
		genres: createProperty('Genre', 'genres', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'book_genres',
			joinColumns: ['book_id'],
			inverseJoinColumns: ['genre_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

export const AuthorMetadata: EntityMetadata<Author> = {
	name: 'Author',
	tableName: 'authors',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['author_name']),
		birthYear: createProperty('number', 'birthYear', ['birth_year']),
		nationality: createProperty('string', 'nationality', ['nationality']),
		books: createProperty('Book', 'books', [], {
			referenceType: ReferenceType.ONE_TO_MANY,
			mappedBy: 'author',
		}),
	},
};

export const GenreMetadata: EntityMetadata<Genre> = {
	name: 'Genre',
	tableName: 'genres',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['genre_name']),
		description: createProperty('string', 'description', ['description']),
		books: createProperty('Book', 'books', [], {
			referenceType: ReferenceType.MANY_TO_MANY,
			pivotTable: 'book_genres',
			joinColumns: ['genre_id'],
			inverseJoinColumns: ['book_id'],
			referencedColumnNames: ['id'],
		}),
	},
};

// Export all metadata in a convenient map
export const AllEntityMetadata = {
	Person: PersonMetadata,
	Ring: RingMetadata,
	Fellowship: FellowshipMetadata,
	Quest: QuestMetadata,
	Location: LocationMetadata,
	Region: RegionMetadata,
	Battle: BattleMetadata,
	Army: ArmyMetadata,
	Book: BookMetadata,
	Author: AuthorMetadata,
	Genre: GenreMetadata,
};

// Export all entity classes
export const AllEntityClasses = {
	Person,
	Ring,
	Fellowship,
	Quest,
	Location,
	Region,
	Battle,
	Army,
	Book,
	Author,
	Genre,
};
