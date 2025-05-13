# General

- [ ] improve logging

## Components

### GQL to SQL

- [x] field params to add filtering and pagination
- [ ] fix joined filters inside fields

## Improvements

- [x] improve aliases using incremental number
- [x] define agnostic orm-framework metadata extractor functions and types
- [ ] better function names
  - [ ] organise things in classes
    - [x] GQLtoSQLMapper
    - [ ] QueryManager
- [ ] resolved fields:
  - [ ] define hidrater recursive class NOT a PRIORITY
    - (doesn't work) ~~Object.assign array of custom field resolvers~~
    - [ ] parse each custom field alongside the fields processing
      - [ ] requires a function to "reduce" the result applying it to the result set

# Future

- [ ] ACL: access control list to add to an entity definition and applies the filters based on the @Context
