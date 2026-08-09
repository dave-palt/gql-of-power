import { Alias } from '../queries/alias';
import { keys } from '../utils/object';
import { GQLEntityOrderByInputType } from './gql-types';

export type MappingsType = {
	select: Set<string>;
	rawSelect: Set<string>;
	json: string[];
	outerJoin: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	innerJoin: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	where: string[];
	values: Record<string, any>;
	limit?: number;
	offset?: number;
	orderBy: GQLEntityOrderByInputType<any>[];
	distinct?: boolean;
	alias?: Alias;
	_or: MappingsType[];
	_and: MappingsType[];
	_not: MappingsType[];
	/**
	 * Converted inline filter args from a relation field's `filter` argument
	 * (e.g. `books(filter: { title_eq: "X" })`). Stored by
	 * `handleFieldArguments` and consumed by `mapField`, which passes it to the
	 * child entity's `recursiveMap` as `gqlFilters` so the WHERE lands inside
	 * the child's lateral join subquery (child-row filtering), NOT as an EXISTS
	 * on the parent.
	 */
	inlineFilter?: any;
};

export const mappingsTypeToString = (m: MappingsType, full = false) => {
	return `Mappings:
select: ${full ? [...m.select.values()].join(', ') : m.select.size}
rawSelect: ${full ? [...m.rawSelect.values()].join(', ') : m.rawSelect.size}
json: ${full ? JSON.stringify(m.json) : m.json.length}
innerJoin: ${full ? JSON.stringify(m.innerJoin) : m.innerJoin.length}
outerJoin: ${full ? JSON.stringify(m.outerJoin) : m.outerJoin.length}
where: ${full ? JSON.stringify(m.where) : m.where.length}
values: ${full ? JSON.stringify(m.values) : keys(m.values ?? {}).length}
limit: ${full ? JSON.stringify(m.limit) : m.limit}
offset: ${full ? JSON.stringify(m.offset) : m.offset}
orderBy: ${full ? JSON.stringify(m.orderBy) : m.orderBy.length}
_or: ${full ? JSON.stringify(m._or) : m._or.length}
_and: ${full ? JSON.stringify(m._and) : m._and.length}
_not: ${full ? JSON.stringify(m._not) : m._not.length}
`;
};

export type FilterMappingType = {
	join: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	innerJoin: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	where: string[];
	values: Record<string, any>;
	alias?: Alias;
	unionAll: FilterMappingType[];
};
