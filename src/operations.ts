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

export abstract class ClassOperations {
	abstract _and(input: ClassOperationInputType<any>): any;
	abstract _or(input: ClassOperationInputType<any>): any;
	abstract _not(input: ClassOperationInputType<any>): any;
}
export abstract class ClassOperationsClass<T> {
	abstract _and: T[];
	abstract _or: T[];
	abstract _not: T[];
}
export abstract class FieldOperationsClass<T> {
	abstract _and: T;
	abstract _eq: T;
	abstract _ne: T;
	abstract _in: T[];
	abstract _nin: T[];
	abstract _gt: T;
	abstract _gte: T;
	abstract _lt: T;
	abstract _lte: T;
	abstract _like: T;
	abstract _re: T;
	abstract _ilike: T;
	abstract _fulltext: T;
	abstract _overlap: T[];
	abstract _contains: T;
	abstract _contained: T;
	abstract _between: T[];
	abstract _exists: T;
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
