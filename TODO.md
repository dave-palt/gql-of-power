# General

- [ ] improve logging
- [ ] write readme

## Components

### GQL to SQL

- [x] field params to add filtering and pagination
- [ ] fix joined filters inside fields

## Improvements

- [x] improve aliases using incremental number
- [x] define agnostic orm-framework metadata extractor functions and types
- [ ] Refactor
  - [ ] improve function names
  - [ ] organise things in classes
    - [x] GQLtoSQLMapper
    - [ ] QueryManager
- filter 1:m by attributes of array
  - [ ] filter on quantity (example: select author that have N books)
- [ ] change `OR` conditions into single queries with `union all`
- [ ] reduce load on DB by not using json but string concat and `string_agg` + `JSON.parse()` of the result string

# Future

- [ ] ACL: access control list to add to an entity definition and applies the filters based on the @Context
- [ ] resolved fields:
  - (doesn't work) ~~Object.assign array of custom field resolvers~~
  - [ ] define hidrater recursive class NOT a PRIORITY
    - [ ] parse each custom field alongside the fields processing
      - [ ] requires a function to "reduce" the result applying it to the result set
