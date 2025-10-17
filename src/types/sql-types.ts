import { Field, FieldResolver, registerEnumType } from 'type-graphql';
import { FieldOperations } from '../operations';
import { GQLEntityFilterInputFieldType, GQLEntityPaginationInputType } from './gql-types';

export enum ReferenceType {
	ONE_TO_ONE = '1:1',
	ONE_TO_MANY = '1:m',
	MANY_TO_ONE = 'm:1',
	MANY_TO_MANY = 'm:n',
}
export type EntityProperty = {
	type: string;
	reference?: string;
	name: string;
	fieldNames: string[];
	mappedBy: string;
	joinColumns: string[];
	referencedColumnNames: string[];
	inverseJoinColumns: string[];
	pivotTable: string;
};

export type EntityMetadata<T> = {
	primaryKeys: string[];
	name?: string;
	tableName: string;
	properties: {
		[key in (string & keyof T) | string]: EntityProperty;
	};
};

export type MetadataProvider = {
	exists: (entityName: string) => boolean;
	getMetadata: <T, K extends EntityMetadata<T>>(entityName: string) => K;
	rawQuery: (sql: string, bindings?: any) => string;
	executeQuery: (sql: string, ...params: any[]) => Promise<any>;
};

export enum Sort {
	ASC = 'asc',
	DESC = 'desc',
}
export type OrderByOptions = {
	[x: string]: Sort;
};

export type EnumData = Parameters<typeof registerEnumType>;

export type FieldBaseSettings = { generateFilter?: boolean; enum?: EnumData } & (
	| {}
	| {
			array: true;
			relatedEntityName: () => string;
	  }
);

export type FieldSettings = FieldBaseSettings & {
	type: NonNullable<Parameters<typeof Field>[0]>;
	options?: Parameters<typeof Field>[1];
};
export type RelatedFieldSettings<T> = FieldBaseSettings & {
	type: NonNullable<Parameters<typeof FieldResolver>[0]>;
	options?: Parameters<typeof FieldResolver>[1];
	/**
	 * Required field/s to resolve the custom field.
	 * Example: the custom field is for Account and requires accountId set this to 'accountId' and it will be fetched from the entity even if accountId is not requested in the gql query.
	 */
	requires?: (string & keyof T) | Array<string & keyof T>;
	resolve?: (...any: any) => any;
};

export type FieldsSettings<T> = {
	[key in string & keyof T]: FieldSettings;
};
export type CustomFieldsSettings<T> = {
	[key in Exclude<string, keyof T>]: RelatedFieldSettings<T>;
};

type GQLArgumentsFilterAndPagination<T> = {
	__arguments: Array<
		| {
				filter: GQLEntityFilterInputFieldType<T>;
		  }
		| {
				pagination: GQLEntityPaginationInputType<T>;
		  }
	>;
};

export type ActualValueType<T> = Exclude<T, undefined | null>;
export type ExtractType<T> = ActualValueType<T> extends Array<infer K>
	? ActualValueType<K>
	: ActualValueType<T>;

// Simple field selection type for GraphQL field selection (like graphql-fields output)
export type FieldSelection<T> = {
	[K in keyof T]?: ActualValueType<T[K]> extends Array<infer U>
		? FieldSelection<U> | { __arguments?: any; is_array: true }
		: ActualValueType<T[K]> extends object
		? FieldSelection<ActualValueType<T[K]>> | { __arguments?: any; is_array: false }
		: {} | { __arguments?: any; is_unk: true };
};

// Keep the original complex Fields type for when it's needed
export type Fields<
	T,
	/**
	 *
	 */
	ArrayIdentifierFieldName extends string = 'getItems',
	SingleRecordIdentifierFieldName extends string = 'getEntity'
> = Partial<{
	[key in string & keyof NonNullable<T>]: NonNullable<NonNullable<T>[key]> extends Array<infer E>
		?
				| Fields<NonNullable<E>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName>
				| GQLArgumentsFilterAndPagination<NonNullable<E>>
		: NonNullable<NonNullable<T>[key]> extends infer K
		? K extends infer E
			? ArrayIdentifierFieldName extends keyof NonNullable<E>
				? NonNullable<E>[ArrayIdentifierFieldName] extends () => infer F
					? F extends Array<infer G>
						? Partial<
								| Fields<G, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
										(
											| {
													[key in string & keyof typeof FieldOperations]?: Fields<
														NonNullable<G>,
														ArrayIdentifierFieldName,
														SingleRecordIdentifierFieldName
													>[];
											  }
											| GQLArgumentsFilterAndPagination<G>
										)
						  >
						: {}
					: {}
				: SingleRecordIdentifierFieldName extends keyof NonNullable<K>
				? NonNullable<K>[SingleRecordIdentifierFieldName] extends () => infer F
					?
							| Fields<NonNullable<F>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
									(
										| Partial<{
												[Key in string & keyof F as `${Capitalize<Key>}`]: {
													[key in string & keyof typeof FieldOperations]?: Fields<
														NonNullable<F>,
														ArrayIdentifierFieldName,
														SingleRecordIdentifierFieldName
													>[];
												};
										  }>
										| GQLArgumentsFilterAndPagination<F>
									)
					: Fields<NonNullable<K>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName>
				: NonNullable<T>[key] | GQLArgumentsFilterAndPagination<NonNullable<T>[key]>
			: Fields<
					NonNullable<NonNullable<T>[key]>,
					ArrayIdentifierFieldName,
					SingleRecordIdentifierFieldName
			  >
		: {};
}>;
