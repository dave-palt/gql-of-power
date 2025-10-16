import { Alias } from '../queries';
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
