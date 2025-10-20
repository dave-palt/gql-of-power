# GQL-of-Power Web Playground

Interactive playground for exploring the `@dav3/gql-of-power` library with Middle-earth data.

## Features

- 🧙‍♂️ **Middle-earth Schema**: Explore relationships between Hobbits, Wizards, Elves, and more
- 🔍 **Advanced Filtering**: Test complex GraphQL filters and operations  
- 🚀 **Bun Powered**: Uses Bun SQLite with Knex for parameter binding
- 🎮 **GraphiQL Interface**: Interactive query playground with example queries
- ⚡ **Zero Setup**: In-memory database with pre-populated sample data

## Quick Start

```bash
# Install dependencies
bun install

# Start the playground server
bun run dev
```

Open http://localhost:4000/graphql to access the GraphiQL playground.

## Example Queries

### Get All Persons
```graphql
query GetAllPersons {
  persons {
    id
    name
    race
    home
    ring {
      name
      power
    }
    fellowship {
      name
      purpose
    }
  }
}
```

### Filter by Name
```graphql
query GetPersonWithBattles {
  persons(filter: { name: { _like: "Aragorn" } }) {
    id
    name
    race
    battles {
      name
      outcome
      casualties
    }
  }
}
```

### Get Rings of Power
```graphql
query GetRingsOfPower {
  rings {
    id
    name
    power
    forgedBy
    bearer {
      name
      race
    }
  }
}
```

## Architecture

- **Database**: Bun SQLite (in-memory)
- **Parameter Binding**: Knex for safe SQL parameter binding
- **GraphQL**: GraphQL Yoga with Type-GraphQL
- **GQL-of-Power**: Demonstrates the library's core features

## Sample Data

The playground includes:
- **5 Fellowship Members**: Frodo, Gandalf, Aragorn, Legolas, Gimli
- **3 Rings of Power**: The One Ring, Vilya, Narya  
- **1 Fellowship**: Fellowship of the Ring
- **3 Battles**: Helm's Deep, Minas Tirith, Black Gate
- **Relationships**: Ring bearers, fellowship membership, battle participation

Perfect for testing complex relationship queries and filters!