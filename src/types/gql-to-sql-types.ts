import { Alias } from '../queries';
import { keys } from '../utils';
import { GQLEntityOrderByInputType } from './gql-types';

export type MappingsType = {
	select: Set<string>;
	json: string[];
	join: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	filterJoin: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	where: string[];
	values: Record<string, any>;
	limit?: number;
	offset?: number;
	orderBy: GQLEntityOrderByInputType<any>[];
	alias?: Alias;
	_or: MappingsType[];
	_and: MappingsType[];
	_not: MappingsType[];
};

export const mappingsTypeToString = (m: MappingsType) => {
	return `Mappings:
select: ${m.select.size}
json: ${m.json.length}
filterJoin: ${m.filterJoin.length}
join: ${m.join.length}
where: ${m.where.length}
values: ${keys(m.values ?? {}).length}
orderBy: ${m.orderBy.length}
_or: ${m._or.length}
_and: ${m._and.length}
_not: ${m._not.length}
`;
};

export type FilterMappingType = {
	join: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	filterJoin: string[];
	// TODO: convert into matrix [][] with an array for each _or condition
	where: string[];
	values: Record<string, any>;
	alias?: Alias;
	unionAll: FilterMappingType[];
};
