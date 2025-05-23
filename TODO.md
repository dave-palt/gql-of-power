# General

- [ ] improve logging
- [ ] write readme
- [ ] build and publish on npm

## Components

### GQL to SQL mapper

- [x] field params to add filtering and pagination
- [x] fix joined filters inside fields
- [x] replace `${alias}.${xxx}` with `alias.toParamName(xxx)` and `alias.toColumnName(xxx)`
- [x] wrap table names with `"`

## Key limitations

- [x] change `OR` conditions into single queries with `union all`
  - [x] `OR` filtering works only for columns in the same table
- [ ] class level `AND` conditions
  - [ ] with multiple sub `OR`
- [ ] class level `NOT` conditions
- [*] reduce load on DB by not using json but string concat and `string_agg` + `JSON.parse()` of the result string
  - issues with typings
- [ ] order by reference table ( query authors order by latest book publication date)

## Improvements

- [x] improve aliases using incremental number
- [x] define agnostic orm-framework metadata extractor functions and types

  - [ ] improve types

- Refactor

  - [x] improve function names
    - [x] fields
    - [x] filters
  - [WIP] organise things in classes
    - [*] GQLtoSQLMapper
      - [WIP] refactor mapper functions
    - [ ] QueryManager
      - [ ] move query builder into GQLtoSQLMapper

- 1:1 example: select author by person

  - [x] filter results based on condition
  - [x] field contains only records based on condition

- 1:m example: select author by books

  - [x] filter results based on condition
  - [x] field contains only records based on condition

- m:1 example: select books by author

  - [x] filter results based on condition
  - [x] field contains only records based on condition

- m:m example: select books by revisors

  - [x] by attributes of array
  - [x] filter on quantity (example: select author that have N books)

# Future

- [ ] ACL: access control list to add to an entity definition and applies the filters based on the @Context
- [*] resolved fields:

  - (doesn't work) ~~Object.assign array of custom field resolvers~~
  - [x] maybe returning the field with a random value will trigger a field resolver
    - [ ] add automatic FieldResolver

- [ ] duplicate fields with alias ( `author { books(filter, pagination) { id } book: books(filter, pagination) { id } }` )
