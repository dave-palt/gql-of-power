import { Knex } from 'knex';
import { Field, FieldResolver, registerEnumType } from 'type-graphql';
import { FieldOperations } from '../operations';
import { GQLEntityFilterInputFieldType, GQLEntityPaginationInputType } from './gql-types';
import { ExtractArrayType } from './utils';

export enum ReferenceType {
	ONE_TO_ONE = '1:1',
	ONE_TO_MANY = '1:m',
	MANY_TO_ONE = 'm:1',
	MANY_TO_MANY = 'm:n',
}
export type EntityProperty = {
	type: string;
	reference?: ReferenceType | string;
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

export type RawSQLHandler = {
	rawQuery: (sql: string, bindings?: any) => string;
};

export type SqlClientConfiguration = {
	client: string | typeof Knex.Client;
};

export type DatabaseDriver = RawSQLHandler | SqlClientConfiguration;

export type MetadataProvider = {
	exists: (entityName: string) => boolean;
	getMetadata: <T, K extends EntityMetadata<T>>(entityName: string) => K;
	executeQuery: (sql: string, ...params: any[]) => Promise<any>;
} & SqlClientConfiguration;

export type MetadataProviderType = MetadataProvider & DatabaseDriver;

export enum Sort {
	ASC = 'asc',
	DESC = 'desc',
}
export type OrderByOptions = {
	[x: string]: Sort;
};

export type EnumData = Parameters<typeof registerEnumType>;

type GetFieldType = NonNullable<Parameters<typeof Field>[0]>;
type GetFieldResolverType = NonNullable<Parameters<typeof FieldResolver>[0]>;

export type FieldBaseSettings = { generateFilter?: boolean; enum?: EnumData } & (
	| {}
	| {
			array: true;
			relatedEntityName: () => string;
			/**
			 * GQL Type for contains or overlap.
			 * This should match the type of the related field like id (probably Int).
			 * Without this the filters overlap and contains will not be generated.
			 */
			getFilterType?: GetFieldResolverType;
			alias?: string;
			/**
			 * When set, generates an additional Int field on the GQL entity that returns
			 * the count of related entities. The value becomes the field name in the GQL schema.
			 * A `filter` argument is automatically registered on the count field, allowing
			 * clients to filter the related entities before counting.
			 *
			 * The generated SQL is a correlated subquery:
			 * ```sql
			 * (SELECT COUNT(*) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id AND <filter>) AS "bookCount"
			 * ```
			 *
			 * @example
			 * // Author entity with book count
			 * const fields = defineFields(Author, {
			 *   books: {
			 *     type: () => BookGQL,
			 *     array: true,
			 *     countFieldName: 'bookCount',
			 *     relatedEntityName: () => 'Book',
			 *   },
			 * });
			 *
			 * // GQL query:
			 * query {
			 *   authors {
			 *     bookCount(filter: { genre: 'Fantasy' })
			 *   }
			 * }
			 */
			countFieldName?: string;
	  }
);

export type FieldOptions = Parameters<typeof Field>[1];
export type RelatedFieldOptions = Parameters<typeof FieldResolver>[1];

export type FieldSettings = FieldBaseSettings & {
	type: GetFieldType;
	options?: FieldOptions;
	alias?: string;
};

export type RelatedFieldSettings<T> = FieldBaseSettings & {
	type: GetFieldResolverType;
	options?: RelatedFieldOptions;
	/**
	 * Required field/s to resolve the custom field.
	 * Example: the custom field is for Author and requires authorId set this to 'authorId' and it will be fetched from the entity even if authorId is not requested in the gql query.
	 */
	requires?: (string & keyof T) | Array<string & keyof T>;
	resolve?: (...any: any) => any;
	alias?: string;
};

/**
 * Describes a SQL JOIN from the owner entity to a reference ORM entity via
 * one or more foreign key columns.
 *
 * Use this in `customFields` when the relationship is **not** declared as an ORM
 * relation (e.g. the FK exists as a plain property like `authorId: string`)
 * and you want the library to generate the SQL JOIN automatically.
 *
 * Both `refFields` and `fields` accept a single string (shorthand for the common
 * single-column FK) or an array of strings for composite keys.
 *
 * @typeParam TOwner - The ORM entity class that owns the FK column(s)
 * @typeParam TRef   - The ORM entity class being joined to (inferred from `refEntity`)
 *
 * @example
 * // Single FK column — string shorthand
 * const mapping: FieldMappingConfig<Book, Author> = {
 *   refEntity: Author,
 *   refFields: 'id',           // column on Author
 *   fields:    'authorId',     // column on Book
 * };
 *
 * @example
 * // Composite FK — array form
 * const mapping: FieldMappingConfig<Fellowship, Person> = {
 *   refEntity: Person,
 *   refFields: ['fellowshipId', 'race'],
 *   fields:    ['fellowshipId',  'race'],
 * };
 */
export type FieldMappingConfig<TOwner, TRef = any> = {
	/** The ORM entity class to JOIN to. Must be registered in the metadata provider. */
	refEntity: new () => TRef;
	/**
	 * The property name(s) on `refEntity` to match against.
	 * Accepts a single property name or an array for composite keys.
	 * Must have the same length as `fields`.
	 * Values are type-checked as `keyof TRef`.
	 */
	refFields: (string & keyof TRef) | Array<string & keyof TRef>;
	/**
	 * The property name(s) on the owner entity to match from.
	 * Accepts a single property name or an array for composite keys.
	 * Must have the same length as `refFields`.
	 * Values are type-checked as `keyof TOwner`.
	 */
	fields: (string & keyof TOwner) | Array<string & keyof TOwner>;
};

/**
 * Settings for a custom GraphQL field that is resolved outside the main entity's table.
 *
 * There are two mutually exclusive resolution strategies — you must provide exactly one:
 *
 * ---
 * ### `resolve` strategy
 * Provide a GraphQL `@FieldResolver` function. The library ensures the field(s) listed in
 * `requires` are fetched from the main SQL query even when not requested by the client,
 * then your `resolve` function runs at GraphQL resolution time.
 *
 * Ideal for DataLoader patterns where you want to batch-load related data.
 *
 * @example
 * ```typescript
 * author: {
 *   type: () => AuthorGQL,
 *   requires: 'authorId',
 *   resolveDecorators: [Root()],
 *   resolve: (root: Book) => authorDataLoader.load(root.authorId),
 * }
 * ```
 *
 * ---
 * ### `mapping` strategy
 * Provide a {@link FieldMappingConfig}. The library generates a SQL JOIN automatically
 * and returns the related object directly from the SQL result — no resolver function needed.
 *
 * Use this when the FK exists as a plain column (not declared as an ORM relation).
 *
 * @example
 * ```typescript
 * author: {
 *   type: () => AuthorGQL,
 *   options: { nullable: true },
 *   mapping: {
 *     refEntity: Author,
 *     refFields: 'id',
 *     fields: 'authorId',
 *   },
 * }
 * ```
 */
export type CustomFieldSettings<T> = Omit<RelatedFieldSettings<T>, 'resolve'> &
	(
		| {
				/**
				 * GraphQL FieldResolver function. Parameters are determined by the order of
				 * `resolveDecorators`. Use `requires` (from the base type) to ensure FK columns are
				 * selected from the DB even when the client doesn't request them.
				 */
				resolve: (...any: any) => any;
				/**
				 * type-graphql parameter decorators applied to the resolver method in order.
				 * The resolver function parameters will receive values in the same order.
				 * @example [Root(), Ctx(), Info()]
				 */
				resolveDecorators?: Array<ParameterDecorator>;
				mapping?: never;
		  }
		| {
				/**
				 * Declares a SQL JOIN from this entity to a reference ORM entity.
				 * The library generates the JOIN and returns the related object from SQL.
				 * No `resolve` function or `requires` needed.
				 * @see FieldMappingConfig
				 */
				mapping: FieldMappingConfig<T, any>;
				resolve?: never;
				resolveDecorators?: never;
		  }
	);

export type FieldsSettings<T> = {
	[key in string & keyof T]: FieldSettings;
};
export type CustomFieldsSettings<T> = {
	[key in Exclude<string, keyof T>]: CustomFieldSettings<T>;
};

/**
 * Metadata for an auto-generated count field.
 * Stored internally in CountFieldsMap when a relationship field has `countFieldName` set.
 */
export type CountFieldMeta = {
	/** The GQL field name for the count (e.g. 'bookCount'). */
	countFieldName: string;
	/** The ORM relationship field name that this count derives from (e.g. 'books'). */
	relationshipFieldName: string;
	/** Resolves to the related entity's ORM class name (e.g. 'Book'). */
	relatedEntityName: () => string;
};

export type GQLArgumentsFilterAndPagination<T> =
	| {
			filter: GQLEntityFilterInputFieldType<T>;
	  }
	| {
			pagination: GQLEntityPaginationInputType<T>;
	  };

export type ActualValueType<T> = Exclude<T, undefined | null>;
export type ExtractType<T> =
	ActualValueType<T> extends Array<infer K> ? ActualValueType<K> : ActualValueType<T>;

export type FieldsDetailsMap<T> = {
	[key in keyof ExtractArrayType<T>]?: FieldDetails<ExtractArrayType<T>, key>;
};
export type FieldDetails<T, K extends keyof T> = {
	name?: K;
	alias?: string;
	args?: Record<string, any> | GQLArgumentsFilterAndPagination<ExtractArrayType<T[K]>>;
	fieldsByTypeName?: Partial<{
		[key: string]: FieldsDetailsMap<ExtractArrayType<T[K]>>;
	}>;
};
// Simple field selection type for GraphQL field selection (like graphql-parse-resolve-info output)
export type FieldSelection<T> = Partial<{
	[K in keyof ExtractArrayType<T>]?: FieldDetails<ExtractArrayType<T>, K> | {};
}>;

// Keep the original complex Fields type for when it's needed
export type Fields<
	T,
	/**
	 *
	 */
	ArrayIdentifierFieldName extends string = 'getItems',
	SingleRecordIdentifierFieldName extends string = 'getEntity',
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
									Fields<G, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
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
							? Fields<NonNullable<F>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
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
