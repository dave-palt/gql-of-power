-- Database Schema for Middle-earth Integration Tests
-- This schema supports all relationship types for comprehensive testing
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS quest_locations CASCADE;

DROP TABLE IF EXISTS book_genres CASCADE;

DROP TABLE IF EXISTS book_characters CASCADE;

DROP TABLE IF EXISTS army_battles CASCADE;

DROP TABLE IF EXISTS person_battles CASCADE;

DROP TABLE IF EXISTS battle_locations CASCADE;

DROP TABLE IF EXISTS battles CASCADE;

DROP TABLE IF EXISTS locations CASCADE;

DROP TABLE IF EXISTS armies CASCADE;

DROP TABLE IF EXISTS books CASCADE;

DROP TABLE IF EXISTS genres CASCADE;

DROP TABLE IF EXISTS authors CASCADE;

DROP TABLE IF EXISTS rings CASCADE;

DROP TABLE IF EXISTS persons CASCADE;

DROP TABLE IF EXISTS fellowships CASCADE;

DROP TABLE IF EXISTS quests CASCADE;

DROP TABLE IF EXISTS regions CASCADE;

-- Create tables
-- Regions (independent table)
CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    region_name VARCHAR(100) NOT NULL,
    ruler_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quests (independent table)
CREATE TABLE quests (
    id SERIAL PRIMARY KEY,
    quest_name VARCHAR(200) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    success BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fellowships (references quests - m:1)
CREATE TABLE fellowships (
    id SERIAL PRIMARY KEY,
    fellowship_name VARCHAR(200) NOT NULL,
    purpose TEXT,
    formed_date DATE,
    disbanded BOOLEAN DEFAULT FALSE,
    quest_id INTEGER REFERENCES quests(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Persons (references fellowships - m:1)
CREATE TABLE persons (
    id SERIAL PRIMARY KEY,
    person_name VARCHAR(100) NOT NULL,
    age INTEGER,
    race VARCHAR(50) NOT NULL,
    home_location VARCHAR(200),
    fellowship_id INTEGER REFERENCES fellowships(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rings (references persons as bearer - 1:1)
CREATE TABLE rings (
    id SERIAL PRIMARY KEY,
    ring_name VARCHAR(100) NOT NULL,
    power_description TEXT,
    forged_by VARCHAR(100),
    bearer_id INTEGER UNIQUE REFERENCES persons(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

alter table
    persons
add
    column ring_id INTEGER REFERENCES rings(id);

-- Authors (independent table)
CREATE TABLE authors (
    id SERIAL PRIMARY KEY,
    author_name VARCHAR(100) NOT NULL,
    birth_year INTEGER,
    nationality VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Genres (independent table)
CREATE TABLE genres (
    id SERIAL PRIMARY KEY,
    genre_name VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Books (references authors - m:1)
CREATE TABLE books (
    id SERIAL PRIMARY KEY,
    book_title VARCHAR(200) NOT NULL,
    published_year INTEGER,
    page_count INTEGER,
    author_id INTEGER REFERENCES authors(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Locations (references regions - m:1)
CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    location_name VARCHAR(100) NOT NULL,
    location_type VARCHAR(50),
    description TEXT,
    region_id INTEGER REFERENCES regions(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Battles (independent table, locations via m:m)
CREATE TABLE battles (
    id SERIAL PRIMARY KEY,
    battle_name VARCHAR(200) NOT NULL,
    battle_date DATE,
    outcome VARCHAR(50),
    casualties INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Armies (independent table)
CREATE TABLE armies (
    id SERIAL PRIMARY KEY,
    army_name VARCHAR(200) NOT NULL,
    army_size INTEGER,
    allegiance VARCHAR(50),
    leader_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Junction Tables for Many-to-Many relationships
-- Person <-> Battle (m:m)
CREATE TABLE person_battles (
    person_id INTEGER REFERENCES persons(id) ON DELETE CASCADE,
    battle_id INTEGER REFERENCES battles(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, battle_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Army <-> Battle (m:m)
CREATE TABLE army_battles (
    army_id INTEGER REFERENCES armies(id) ON DELETE CASCADE,
    battle_id INTEGER REFERENCES battles(id) ON DELETE CASCADE,
    PRIMARY KEY (army_id, battle_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Book <-> Person (characters) (m:m)
CREATE TABLE book_characters (
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES persons(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, person_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Book <-> Genre (m:m)
CREATE TABLE book_genres (
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, genre_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quest <-> Location (m:m)
CREATE TABLE quest_locations (
    quest_id INTEGER REFERENCES quests(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    PRIMARY KEY (quest_id, location_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Battle <-> Location (m:m)
CREATE TABLE battle_locations (
    battle_id INTEGER REFERENCES battles(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    PRIMARY KEY (battle_id, location_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_persons_fellowship_id ON persons(fellowship_id);

CREATE INDEX idx_persons_race ON persons(race);

CREATE INDEX idx_rings_bearer_id ON rings(bearer_id);

CREATE INDEX idx_books_author_id ON books(author_id);

CREATE INDEX idx_locations_region_id ON locations(region_id);

CREATE INDEX idx_fellowships_quest_id ON fellowships(quest_id);

CREATE INDEX idx_battle_locations_battle_id ON battle_locations(battle_id);

CREATE INDEX idx_battle_locations_location_id ON battle_locations(location_id);

-- Add some constraints for data integrity
ALTER TABLE
    persons
ADD
    CONSTRAINT check_age_positive CHECK (
        age > 0
        OR age IS NULL
    );

ALTER TABLE
    battles
ADD
    CONSTRAINT check_casualties_positive CHECK (casualties >= 0);

ALTER TABLE
    armies
ADD
    CONSTRAINT check_army_size_positive CHECK (army_size > 0);

ALTER TABLE
    books
ADD
    CONSTRAINT check_published_year_reasonable CHECK (published_year > 1000);

ALTER TABLE
    authors
ADD
    CONSTRAINT check_birth_year_reasonable CHECK (birth_year > 1000);