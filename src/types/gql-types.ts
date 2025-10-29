import { ClassOperationsClass, FieldOperationsClass } from '../operations';
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
export type FieldValuesObjectOperationsType<T> = DefinedType<T> extends Array<infer K>
	? {
			[k in string &
				keyof Pick<
					FieldOperationsClass<DefinedType<K>>,
					'_in' | '_nin' | '_contains' | '_eq' | '_overlap'
				>]?: FieldOperationsClass<DefinedType<K>>[k] | null;
	  }
	: {
			[k in string & keyof FieldOperationsClass<DefinedType<T>>]?:
				| FieldOperationsClass<DefinedType<T>>[k]
				| null;
	  };

/**
 * { \[field\]: { _eq: typeof T\[field\], ... } }
 */
export type FieldValuesObjectType<T> = DefinedType<DefinedType<T>> extends Array<infer K>
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
export type FieldFilterType<T> = //FieldValuesType<T> &
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

export type GQLEntityOrderByInputType<T> = Partial<Record<string & keyof T, 'asc' | 'desc'>>;

export type GQLEntityPaginationInputType<T> = {
	limit?: number;
	offset?: number;
	orderBy?: GQLEntityOrderByInputType<T>[];
};
