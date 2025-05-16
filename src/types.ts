import { Field, FieldResolver, registerEnumType } from 'type-graphql';
import { ClassOperations, FieldOperations } from './operations';
import { Alias } from './queries';

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
		[key in string & keyof T]: EntityProperty;
	};
};

export type MetadataProvider = {
	exists: (arg: string) => boolean;
	getMetadata: <T, K extends EntityMetadata<T>>(arg: string) => K;
	rawQuery: (sql: string, bindings?: any) => string;
	executeQuery: (sql: string, params?: any[], _?: any) => Promise<any>;
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
	 * Required field to resolve the custom field.
	 * Example: the custom field is for Account and requires crmAccountId => 'crmAccountId'
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

export type Fields<T> = Partial<{
	[key in string & keyof NonNullable<T>]: NonNullable<NonNullable<T>[key]> extends Array<infer E>
		? Fields<NonNullable<E>> & GQLArgumentsFilterAndPagination<NonNullable<E>>
		: NonNullable<NonNullable<T>[key]> extends infer K
		? K extends infer E
			? 'getItems' extends keyof NonNullable<E>
				? NonNullable<E>['getItems'] extends () => infer F
					? F extends Array<infer G>
						? Partial<
								Fields<G> & {
									[key in string & keyof typeof FieldOperations]?: Fields<NonNullable<G>>[];
								} & GQLArgumentsFilterAndPagination<G>
						  >
						: {}
					: {}
				: 'getEntity' extends keyof NonNullable<K>
				? NonNullable<K>['getEntity'] extends () => infer F
					? Fields<NonNullable<F>> &
							Partial<{
								[Key in string & keyof F as `${Capitalize<Key>}`]: {
									[key in string & keyof typeof FieldOperations]?: Fields<NonNullable<F>>[];
								};
							}> &
							GQLArgumentsFilterAndPagination<F>
					: Fields<NonNullable<K>>
				: NonNullable<T>[key] & GQLArgumentsFilterAndPagination<NonNullable<T>[key]>
			: Fields<NonNullable<NonNullable<T>[key]>>
		: {};
}>;

export type GQLEntityFilterInputFieldType<T> = {
	[key in string & keyof T]?: T[key];
} & {
	[key in string & keyof typeof ClassOperations]?: GQLEntityFilterInputFieldType<T>[];
} & {
	[Key in string & keyof T as `${Capitalize<Key>}`]: {
		[key in string & keyof typeof FieldOperations]?: GQLEntityFilterInputFieldType<T>[];
	};
};
export type GQLEntityOrderByInputType<T> = {
	[Key in string & keyof T]: ['asc', 'desc'];
};
export type GQLEntityPaginationInputType<T> = {
	limit?: number;
	offset?: number;
	orderBy?: GQLEntityOrderByInputType<T>[];
};

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
	latestAlias: Alias;
};
