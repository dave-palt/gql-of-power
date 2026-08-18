import { ClassOperationsClass, FieldOperationsClass } from '../field-operations';
import {
	ConcatConditionalArray,
	DefinedType,
	ExtractArrayType,
	OmitArrays,
	Primitives,
} from './utils';

/**
 * \[_field\]: T\[field\]
 *
 * @deprecated we don't use \[field\]: T\[field\] anymore
 */
export type FieldValuesType<T> = {
	[key in string & keyof OmitArrays<DefinedType<T>> as `_${key}`]?: Partial<
		ExtractArrayType<OmitArrays<DefinedType<T>>[key]>
	>;
};

/**
 * \[field_eq\]: T\[field\]
 */
export type FieldOperationsType<T> = Partial<
	ConcatConditionalArray<DefinedType<T>, FieldOperationsClass<DefinedType<T>>>
>;

/**
 *  - \[_eq\]: typeof T\[field\]
 *  - \[_in\]: typeof T\[field\]\[\]
 *  - etc...
 */
export type FieldValuesObjectOperationsType<T> =
	DefinedType<T> extends Array<infer K>
		? {
				[
					k in string &
						keyof Pick<
							FieldOperationsClass<DefinedType<K>>,
							'_in' | '_nin' | '_contains' | '_eq' | '_overlap'
						>
				]?: FieldOperationsClass<DefinedType<K>>[k] | null;
			}
		: {
				[k in string & keyof FieldOperationsClass<DefinedType<T>>]?:
					FieldOperationsClass<DefinedType<T>>[k] | null;
			};

/**
 * { \[field\]: { _eq: typeof T\[field\], ... } }
 */
export type FieldValuesObjectType<T> =
	DefinedType<DefinedType<T>> extends Array<infer K>
		? Partial<FieldValuesObjectType<DefinedType<K>>>
		: DefinedType<T> extends Primitives
			? Partial<FieldValuesObjectOperationsType<DefinedType<T>>>
			: {
					[key in string & keyof DefinedType<T>]?: DefinedType<DefinedType<T>[key]> extends Array<
						infer K
					>
						? K extends Primitives
							? Partial<FieldValuesObjectOperationsType<ExtractArrayType<DefinedType<K>>>>
							: Partial<GQLEntityFilterInputFieldType<DefinedType<K>>>
						: Partial<GQLEntityFilterInputFieldType<DefinedType<DefinedType<T>[key]>>>;
				};

/**
 *  - \[_field\]: T\[field\]
 *  - \[field_eq\]: T\[field\]
 *  - \[field\]: { _eq: typeof T\[field\], ... }
 */
export type FieldFilterType<T> =
	//FieldValuesType<T> &
	Partial<FieldValuesObjectType<T>> & Partial<FieldOperationsType<T>>;

/**
 *  - \[_and\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_or\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_not\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 */
export type ClassOperationsType<T> = Partial<{
	[key in string & keyof ClassOperationsClass<T>]?: Array<
		FieldFilterType<T> & ClassOperationsType<T>
	>;
}>;

/**
 *  - \[_field\]: T\[field\]
 *  - \[field_eq\]: T\[field\]
 *  - \[field\]: { _eq: typeof T\[field\], ... }
 *
 *  - \[_and\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_or\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_not\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 */
export type GQLEntityFilterInputFieldType<T> = Partial<FieldFilterType<T>> & ClassOperationsType<T>;

export type GQLEntityFilterInputFieldValueType<T> = Partial<
	GQLEntityFilterInputFieldType<T>[keyof GQLEntityFilterInputFieldType<T>]
>;

/**
 * ORDER BY input type. Scalar fields map to 'asc' | 'desc'.
 * Relationship fields (m:1, 1:m, m:m) accept a nested object so TypeScript
 * provides autocomplete at every level, e.g.:
 *   orderBy: [{ fellowship: { name: 'asc' } }]
 *
 * The recursion is bounded by the entity's own relationship properties —
 * at the leaf level the value is always 'asc' | 'desc'.
 */
export type GQLEntityOrderByInputType<T> = Partial<{
	[K in keyof T]: T[K] extends object
		? GQLEntityOrderByInputType<T[K]> | 'asc' | 'desc'
		: 'asc' | 'desc';
}>;

export type GQLEntityPaginationInputType<T> = {
	limit?: number;
	offset?: number;
	orderBy?: GQLEntityOrderByInputType<T>[];
	/**
	 * When true, the outermost SELECT is emitted as `SELECT DISTINCT`, deduplicating
	 * the final user-facing rows. Useful when relationship JOINs could multiply parent
	 * rows. Does not affect the structural `select distinct *` used inside UNION ALL.
	 */
	distinct?: boolean;
	/**
	 * Strategy for combining `_or` / `_and` filter branches in generated SQL.
	 *
	 * - `'union-all'` (default) — each branch becomes a separate SELECT combined
	 *   with `union all`. Branch-local INNER JOINs stay isolated per branch.
	 * - `'or'` — branches are flattened into a single query with
	 *   `((w1) or (w2) ...)` in the WHERE clause. Index-friendly single scan,
	 *   but branch INNER JOINs are merged (see README caveat on
	 *   relationship-based `_or` branches).
	 *
	 * Overrides the global `setGlobalConfig({ orStrategy })` for this query.
	 */
	orStrategy?: OrStrategy;
};

/**
 * How `_or` / `_and` filter branches are combined into SQL.
 * See `GQLEntityPaginationInputType.orStrategy` for the full description.
 */
export type OrStrategy = 'union-all' | 'or';

/**
 * Represents the auto-generated Input type for CRUD operations.
 * All scalar fields from defineFields are included as optional,
 * relation and custom fields are excluded.
 *
 * @example
 * // Usage in a mutation:
 * @Mutation(() => PersonGQL)
 * async createPerson(@Arg('input') input: typeof PersonGQL.Input) { ... }
 */
export type GQLEntityInputType<T> = Partial<OmitArrays<DefinedType<T>>>;
