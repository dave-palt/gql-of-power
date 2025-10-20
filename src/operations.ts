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

export const getFieldOperations = (namedParameterPrefix: string) => ({
	_and: ([l]: string[], [_]: Array<string | number | boolean | bigint | null>) => ({
		where: `and (${l})`,
		value: undefined,
	}),

	_eq: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} ${rv !== null && rv !== 'null' ? `= ${r}` : 'is null'}`,
		value: undefined,
	}),
	_ne: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} ${rv !== null && rv !== 'null' ? `!= ${r}` : 'is not null'}`,
		value: undefined,
	}),
	_in: ([l, ...r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} in (${r.join(', ')})`,
		value: undefined,
	}),
	_nin: (
		[l, r, ..._args]: string[],
		[_, ...values]: Array<string | number | boolean | bigint | null>
	) => {
		console.log(
			'not in ',
			l,
			r,
			_args,
			values,
			`${l} not in (${values.map((_, i) => r + '__' + i).join(', ')})`
		);
		console.log(
			'not in ',
			values.reduce((acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }), {})
		);
		return {
			where: `${l} not in (${values.map((_, i) => r + '__' + i).join(', ')})`,
			value: values.reduce((acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }), {}),
		};
	},
	_gt: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} > ${r}`,
		value: undefined,
	}),
	_gte: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} >= ${r}`,
		value: undefined,
	}),
	_lt: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} < ${r}`,
		value: undefined,
	}),
	_lte: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} <= ${r}`,
		value: undefined,
	}),
	_like: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} like ${r}`,
		value: undefined,
	}),
	_re: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} ~ ${r}`,
		value: undefined,
	}),
	_ilike: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} ilike ${r}`,
		value: undefined,
	}),
	_fulltext: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l}::tsvector @@ ${r}::tsquery`,
		value: undefined,
	}),
	_overlap: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} && ${r}`,
		value: undefined,
	}),
	_contains: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} contains ${r}`,
		value: undefined,
	}),
	_contained: ([l, r]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} contained ${r}`,
		value: undefined,
	}),
	_between: ([l, r1, r2]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `${l} between ${r1} and ${r2}`,
		value: undefined,
	}),
	_exists: ([l]: string[], []: Array<string | number | boolean | bigint | null>) => ({
		where: `exists ${l}`,
		value: undefined,
	}),
});

export const FieldOperations = getFieldOperations(':');
export type FieldOperationsType = typeof FieldOperations;
