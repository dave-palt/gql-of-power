import { Alias } from './queries';
import { EntityMetadata, GQLEntityFilterInputFieldType, MappingsType } from './types';

export type ClassOperationInputType<T> = {
	entityMetadata: EntityMetadata<T>;
	gqlFilters: GQLEntityFilterInputFieldType<T>[];
	fieldName: string & keyof Pick<MappingsType, '_and' | '_not' | '_or'>;
	parentAlias: Alias;
	alias: Alias;
	mapping: MappingsType;
	mappings: Map<string, MappingsType>;
};
export const ClassOps = {
	_and: 1,
	_or: 1,
	_not: 1,
};
export abstract class ClassOperations {
	abstract _and(input: ClassOperationInputType<any>): any;
	abstract _or(input: ClassOperationInputType<any>): any;
	abstract _not(input: ClassOperationInputType<any>): any;
}
export const FieldOperations = {
	_and: ([l]: string[], [_]: Array<string | number | boolean | bigint | null>) => `and (${l})`,

	_eq: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint | null>) =>
		`${l} ${rv !== null && rv !== 'null' ? `= ${r}` : 'is null'}`,
	_ne: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint | null>) =>
		`${l} ${rv !== null && rv !== 'null' ? `!= ${r}` : 'is not null'}`,
	_in: ([l, ...r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} in (${r.join(', ')})`,
	_nin: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} not in (${r})`,
	_gt: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => `${l} > ${r}`,
	_gte: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => `${l} >= ${r}`,
	_lt: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => `${l} < ${r}`,
	_lte: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => `${l} <= ${r}`,
	_like: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} like ${r}`,
	_re: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => `${l} ~ ${r}`,
	_ilike: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} ilike ${r}`,
	_fulltext: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} fulltext ${r}`,
	_overlap: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} overlap ${r}`,
	_contains: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} contains ${r}`,
	_contained: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} contained ${r}`,
	_between: ([l, r1, r2]: string[], []: Array<string | number | boolean | bigint | null>) =>
		`${l} between ${r1} and ${r2}`,
	_exists: ([l]: string[], []: Array<string | number | boolean | bigint | null>) => `exists ${l}`,
};
