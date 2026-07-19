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

type Scalar = string | number | boolean | bigint | null;
type FieldOperation = (
	colRefs: string[],
	valueRefs: Scalar[]
) => { where: string; value: Record<string, Scalar> | undefined };

/**
 * Builds the three array-membership operators (_in / _nin / _contains) that
 * share the same value-binding pattern: each value gets a `<rightRef>__<i>`
 * placeholder, and a value map keyed by the stripped ref + index.
 *
 * `formatWhere` receives the left column ref and the joined placeholder list
 * so each operator only differs in the SQL it emits.
 */
function buildArrayContainmentOperator(
	formatWhere: (left: string, placeholders: string) => string
): FieldOperation {
	return ([l, r, ..._args]: string[], [_, ...values]: Scalar[]) => {
		const placeholders = values.map((_, i) => `${r}__${i}`).join(', ');
		const value = values.reduce(
			(acc, v, i) => ({ ...acc, [r.slice(1) + '__' + i]: v }),
			{} as Record<string, Scalar>
		);
		return { where: formatWhere(l, placeholders), value };
	};
}

export const FieldOperations = {
	_and: ([l]: string[], [_]: Scalar[]) => ({
		where: `and (${l})`,
		value: undefined,
	}),

	_eq: ([l, r]: string[], [_, rv]: Scalar[]) => ({
		where: `${l} ${rv !== null && rv !== 'null' ? `= ${r}` : 'is null'}`,
		value: undefined,
	}),

	_ne: ([l, r]: string[], [_, rv]: Scalar[]) => ({
		where: `${l} ${rv !== null && rv !== 'null' ? `!= ${r}` : 'is not null'}`,
		value: undefined,
	}),

	_in: buildArrayContainmentOperator((l, placeholders) => `${l} in (${placeholders})`),
	_nin: buildArrayContainmentOperator((l, placeholders) => `${l} not in (${placeholders})`),
	_contains: buildArrayContainmentOperator(
		(l, placeholders) => `ARRAY[${l}] @> ARRAY[${placeholders}]`
	),

	_gt: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} > ${r}`,
		value: undefined,
	}),
	_gte: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} >= ${r}`,
		value: undefined,
	}),
	_lt: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} < ${r}`,
		value: undefined,
	}),
	_lte: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} <= ${r}`,
		value: undefined,
	}),
	_like: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} like ${r}`,
		value: undefined,
	}),
	_re: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} ~ ${r}`,
		value: undefined,
	}),
	_ilike: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} ilike ${r}`,
		value: undefined,
	}),
	_fulltext: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l}::tsvector @@ ${r}::tsquery`,
		value: undefined,
	}),
	_overlap: ([l, r]: string[], []: Scalar[]) => ({
		where: `ARRAY[${l}] && ARRAY[${r}]`,
		value: undefined,
	}),
	_contained: ([l, r]: string[], []: Scalar[]) => ({
		where: `${l} contained ${r}`,
		value: undefined,
	}),
	_between: ([l, r1, r2]: string[], []: Scalar[]) => ({
		where: `${l} between ${r1} and ${r2}`,
		value: undefined,
	}),
	_exists: ([l]: string[], []: Scalar[]) => ({
		where: `exists ${l}`,
		value: undefined,
	}),
};

export type FieldOperationsType = typeof FieldOperations;
