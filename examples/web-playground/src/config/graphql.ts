/**
 * GraphQL Playground configuration
 * Default queries and UI setup for the interactive playground
 */
export const GRAPHQL_PLAYGROUND_CONFIG = {
	title: 'GQL-of-Power Playground',
	defaultQuery: `# Welcome to GQL-of-Power Playground!
# Try these queries to explore Middle-earth data:

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
}`,
};
