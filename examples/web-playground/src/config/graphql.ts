/**
 * GraphQL Playground configuration
 * Default queries and UI setup for the interactive playground.
 *
 * The default query pack exercises nearly every feature exposed by the library:
 *  - count fields            (memberCount, bookCount, battleCount)
 *  - _exists / _not_exists   (persons who bear a Ring / have not fought a Battle)
 *  - mapNumericEnum          (rings filtered by the RingStatus enum)
 *  - mapping custom field    (persons filtered by their home Region)
 *  - nested relationships    (Author → Book → Genre, Quest → Fellowship → Person…)
 *  - excludeFromInput        (forgedDate is readable but not in the Input type)
 *  - parseJson               (Ring.metadata returned as a JSON object)
 */
export const GRAPHQL_PLAYGROUND_CONFIG = {
	title: 'GQL-of-Power Playground',
	defaultQuery: `# Welcome to the GQL-of-Power Playground!
# This default query set demonstrates the breadth of features the library
# generates from a single FieldsSettings definition. Uncomment any block to run it.

# ─────────────────────────────────────────────────────────────────────────────
# 1. Relationships + count fields
#    Fellowship has a 1:m \`members\` relation with countFieldName: 'memberCount',
#    so the schema exposes an Int \`memberCount\` field plus filter operators.
# ─────────────────────────────────────────────────────────────────────────────
query FellowshipsWithMemberCount {
  fellowships {
    id
    name
    purpose
    memberCount
    members {
      id
      name
      race
    }
    quest {
      name
      description
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. count field with a filter argument + count filter on the parent
#    Author.books also has countFieldName: 'bookCount'. The count field accepts
#    a \`filter\` argument, and the Author filter exposes bookCount_gt/_lt/_eq.
# ─────────────────────────────────────────────────────────────────────────────
query ProlificAuthors {
  authors(filter: { bookCount_gt: 1 }) {
    id
    name
    bookCount
    totalPages
    avgPages
    oldestBookYear
    newestBookYear
    books {
      title
      publishedYear
      genres {
        name
      }
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 2b. aggregate-field filter
#     Author.books also has aggregateFields (sum/avg/min/max on pages &
#     publishedYear). The filter exposes totalPages_gt / _lte / _eq etc.
# ─────────────────────────────────────────────────────────────────────────────
query ProlificAuthorsByPages {
  authors(filter: { totalPages_gt: 500 }) {
    id
    name
    totalPages
    avgPages
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. _exists / _not_exists filters
#    Class-level operators generated automatically for every entity that has an
#    array relationship. \`persons\` has \`battles\` and \`books\` as m:m, so both
#    keys are available inside _exists.
# ─────────────────────────────────────────────────────────────────────────────
query ExistsFilters {
  ringBearers: persons(filter: { _exists: { ring: { name: "The One Ring" } } }) {
    id
    name
    race
  }
  nonCombatants: persons(filter: { _not_exists: { battles: {} } }) {
    id
    name
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 3b. ORDER BY — flat fields via GraphQL, related columns via the
#     programmatic API. The generated *OrderBy input exposes flat Sort fields.
#     Sorting by RELATED columns (nested objects like { author: { name: 'asc' } })
#     is a SQL-engine feature used via getQueryResultsForInfo/Fields pagination —
#     see resolvers.ts for the programmatic example in the comment on the pagination arg.
# ─────────────────────────────────────────────────────────────────────────────
query OrderedLibrary {
  booksByTitle: books(pagination: { orderBy: [{ title: ASC }, { publishedYear: DESC }] }) {
    id
    title
    publishedYear
    author {
      name
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 3c. _or filter — compiled to UNION ALL branches by default. The strategy is a
#     server-side pagination knob (orStrategy: 'or' flattens to a single query
#     with a plain OR — see resolvers.ts comment + README "OR Strategy").
# ─────────────────────────────────────────────────────────────────────────────
query RingsByPowerOrForgedBy {
  rings(filter: { _or: [{ power_like: "%corruption%" }, { forgedBy_eq: "Sauron" }] }) {
    id
    name
    power
    forgedBy
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. mapNumericEnum + excludeFromInput + parseJson
#    Ring.status is stored in the DB as 100/200/300 but exposed as the
#    RingStatus enum. forgedDate is excluded from the Input type but readable
#    here. metadata is a jsonb column returned as a JSON object via parseJson.
# ─────────────────────────────────────────────────────────────────────────────
query RingsOfPower {
  rings(filter: { status: Destroyed }) {
    id
    name
    power
    status
    forgedDate
    metadata
    bearer {
      name
      race
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. Mapping-strategy custom field (filter + selection)
#    Person.homeRegion is a custom field backed by a generated SQL JOIN onto
#    Region via the home_region_id column. generateFilter exposes a nested
#    \`HomeRegion\` filter, and the field itself can be selected like any relation.
# ─────────────────────────────────────────────────────────────────────────────
query PersonsByHomeRegion {
  persons(filter: { HomeRegion: { name_eq: "The Shire" } }) {
    id
    name
    race
    homeRegion {
      id
      name
      ruler
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# 6. Deeply nested relationships across the full graph
#    Region → Location → Battle → Army / Warrior, and Quest → Fellowship →
#    Members → Ring. The mapper builds the JOINs recursively.
# ─────────────────────────────────────────────────────────────────────────────
query MiddleEarthGraph {
  regions {
    name
    ruler
    locationCount
    locations {
      name
      type
      battles {
        name
        outcome
        armies {
          name
          allegiance
        }
        warriors {
          name
          race
        }
      }
    }
  }
}`,
};
