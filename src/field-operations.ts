// fallow-ignore-file unused-class-member -- ClassOperationsClass/FieldOperationsClass are abstract filter-operation shapes used as type constraints (via keyof) in types/gql-types.ts; their members are never statically referenced, only dispatched dynamically by key.

/**
 * Pure leaf module for filter-operation primitives. Deliberately has no imports
 * from types/ or queries/ so that types/*.ts can depend on these shapes without
 * forming a cycle back through operations.ts (which itself imports from types/).
 */

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
	_in: (
		[l, r, ..._args]: string[],
		[_, ...values]: Array<string | number | boolean | bigint | null>
	) => ({
		where: `${l} in (${values.map((_, i) => r + '__' + i).join(', ')})`,
		value: values.reduce((acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }), {}),
	}),
	_nin: (
		[l, r, ..._args]: string[],
		[_, ...values]: Array<string | number | boolean | bigint | null>
	) => ({
		where: `${l} not in (${values.map((_, i) => r + '__' + i).join(', ')})`,
		value: values.reduce((acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }), {}),
	}),
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
		where: `ARRAY[${l}] && ARRAY[${r}]`,
		value: undefined,
	}),
	// this is possibly not implemented correctly
	_contains: (
		[l, r, ..._args]: string[],
		[_, ...values]: Array<string | number | boolean | bigint | null>
	) => ({
		where: `ARRAY[${l}] @> ARRAY[${values.map((_, i) => r + '__' + i).join(', ')}]`,
		value: values.reduce((acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }), {}),
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
};

export type FieldOperationsType = typeof FieldOperations;
