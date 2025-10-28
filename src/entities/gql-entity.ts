import {
	Field,
	getMetadataStorage,
	InputType,
	Int,
	ObjectType,
	registerEnumType,
} from 'type-graphql';
import { FieldOperations } from '../operations';
import {
	CustomFieldsSettings,
	FieldSettings,
	FieldsSettings,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	OrderByOptions,
	RelatedFieldSettings,
	Sort,
} from '../types';
import { AccessControlEntry, AccessControlList } from '../types/access-control';
import { keys } from '../utils';
import { logger } from '../variables';

const TypeMap: { [key: string]: any } = {};

const FieldsOptionsMap: Record<string, Record<string, string>> = {};
const CustomFieldsMap: Record<string, CustomFieldsSettings<any>> = {};

const aclMap: AccessControlList<any, any> = {};

let gqlTypesSuffix = '';

export const setGlobalConfig = (config: { gqlTypesSuffix: string }) => {
	gqlTypesSuffix = config.gqlTypesSuffix;
};

export const getFieldsOptionsFor = (name: string): Record<string, string> =>
	FieldsOptionsMap[name] ?? {};
export const getFieldByAlias = (entityName: string | undefined, alias: string): string =>
	FieldsOptionsMap[entityName ?? '__no__use__']?.[alias] ?? alias;
export const getCustomFieldsFor = (name: string) => CustomFieldsMap[name] ?? {};

export const getACLFor = (name: string) => aclMap[name] ?? {};

export const getGQLEntityNameFor = (name: string) => `${name}${gqlTypesSuffix}`;
export const getGQLEntityNameForClass = <T>(classType: new () => T) =>
	getGQLEntityNameFor(classType.name);
export const getGQLEntityFieldResolverName = (gqlEntityName: string) =>
	`${gqlEntityName}FieldsResolver`;
export const getGQLEntityFieldResolverNameFor = <T extends Object>(classType: new () => T) =>
	getGQLEntityFieldResolverName(getGQLEntityNameForClass(classType));
export const getGQLEntityTypeFor = <T extends Object, K>(classType: new () => T) =>
	getGQLEntityFieldResolverName(TypeMap[getGQLEntityNameForClass(classType)]);

registerEnumType(Sort, {
	name: `Sort${gqlTypesSuffix}`,
});

export function createGQLTypes<T extends Object, K>(
	classType: new () => T,
	opts: Partial<FieldsSettings<T>>,
	{
		customFields,
		acl,
	}: {
		customFields?: CustomFieldsSettings<T>;
		acl?: AccessControlEntry<T, K>;
	} = {}
) {
	const metadata = getMetadataStorage();

	const gqlEntityName = getGQLEntityNameForClass(classType);

	aclMap[gqlEntityName] = acl ?? {};

	const fields = keys(opts);

	class GQLEntity {
		_____name = gqlEntityName;
	}
	Object.defineProperty(GQLEntity, 'name', { value: gqlEntityName });
	TypeMap[gqlEntityName] = GQLEntity;

	class GQLEntityFilterInput {
		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_and?: GQLEntityFilterInput[];

		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_or?: GQLEntityFilterInput[];

		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_not?: GQLEntityFilterInput[];
	}
	Object.defineProperty(GQLEntityFilterInput, 'name', {
		value: gqlEntityName + 'FilterInput',
	});
	TypeMap[gqlEntityName + 'FilterInput'] = GQLEntityFilterInput;

	class GQLEntityOrderBy {}
	Object.defineProperty(GQLEntityOrderBy, 'name', {
		value: gqlEntityName + 'OrderBy',
	});
	TypeMap[gqlEntityName + 'OrderBy'] = GQLEntityOrderBy;

	if (customFields) {
		CustomFieldsMap[gqlEntityName] = customFields;

		logger.info('CustomFieldsMap', gqlEntityName, customFields);

		for (const fieldName of keys(customFields)) {
			const fieldOptions = fieldName in customFields ? customFields[fieldName] : undefined;

			if (!fieldOptions) {
				continue;
			}
			const fieldNameOverride = fieldOptions.alias;
			if (fieldNameOverride) {
				FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
				FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
			}

			const fieldNameToUse = fieldNameOverride ?? fieldName;

			metadata.collectClassFieldMetadata({
				target: GQLEntity,
				name: fieldNameToUse,
				schemaName: fieldNameToUse,
				getType: fieldOptions.type,
				typeOptions: {
					...('array' in fieldOptions && fieldOptions.array ? { array: true, arrayDepth: 1 } : {}),
					...fieldOptions.options,
				},
				complexity: undefined,
				description: fieldNameToUse,
				deprecationReason: undefined,
			});
		}
	}

	InputType(gqlEntityName + 'OrderBy')(GQLEntityOrderBy);

	const paginationTypeName = `${gqlEntityName}PaginationInput`;

	@InputType(paginationTypeName)
	class GQLEntityPaginationInputField {
		@Field(() => Int, {
			nullable: true,
		})
		limit?: number;

		@Field(() => Int, {
			nullable: true,
		})
		offset?: number;

		@Field(() => [GQLEntityOrderBy], { nullable: true })
		orderBy?: OrderByOptions[];
	}
	Object.defineProperty(GQLEntityPaginationInputField, 'name', {
		value: paginationTypeName,
	});
	TypeMap[paginationTypeName] = GQLEntityPaginationInputField;

	for (const fieldName of fields) {
		const fieldOptions = fieldName in opts ? opts[fieldName] : undefined;
		if (!fieldOptions) {
			continue;
		}
		const fieldNameOverride = fieldOptions.alias;
		if (fieldNameOverride) {
			FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
			FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
			console.log('FieldsOptionsMap', gqlEntityName, FieldsOptionsMap[gqlEntityName]);
		}
		const fieldNameToUse = fieldNameOverride ?? fieldName;

		console.log('Creating GQL Field:', gqlEntityName, { fieldNameToUse, fieldName });
		createGQLEntityFields(
			fieldOptions,
			fieldNameToUse,
			GQLEntity,
			metadata,
			GQLEntityOrderBy,
			gqlEntityName,
			GQLEntityFilterInput
		);
	}

	//   acl && AuthorizeAccess(acl)({ name: gqlEntityName } as any);
	ObjectType(gqlEntityName)(GQLEntity);

	InputType(gqlEntityName + 'FilterInput')(GQLEntityFilterInput);

	return {
		GQLEntity,
		GQLEntityFilterInput: GQLEntityFilterInput as any as GQLEntityFilterInputFieldType<T>,
		GQLEntityPaginationInputField:
			GQLEntityPaginationInputField as any as GQLEntityPaginationInputType<T>,
		/**
		 * this can be used alongside `getGQLEntityTypeFor` to get the type of the entity, not sure it will be ever needed
		 */
		gqlEntityName,
		relatedEntityName: classType.name,
	};
}
type TypeGQLMetadataStorage = ReturnType<typeof getMetadataStorage>;

type FieldParameter = Parameters<TypeGQLMetadataStorage['collectClassFieldMetadata']>[0];

export function createGQLEntityFields<T, K>(
	fieldOptions: FieldSettings | RelatedFieldSettings<T>,
	fieldName: string,
	GQLEntity: new () => T,
	metadata: TypeGQLMetadataStorage,
	GQLEntityOrderBy: any,
	gqlEntityName: string,
	GQLEntityFilterInput: new () => K
) {
	const getType: FieldSettings['type'] = fieldOptions.type;

	const isArray = 'array' in fieldOptions && fieldOptions.array;

	const field = {
		target: GQLEntity,
		name: fieldName,
		schemaName: fieldName,
		getType: fieldOptions.type,
		complexity: undefined,
		description: fieldName,
		deprecationReason: undefined,
		options: {
			...fieldOptions.options,
			...(isArray ? { array: true, arrayDepth: 1 } : {}),
		},
		typeOptions: {
			...(isArray ? { array: true, arrayDepth: 1 } : {}),
			...fieldOptions.options,
		},
	} as FieldParameter;
	metadata.collectClassFieldMetadata(field);

	if (fieldOptions.enum) {
		const enumObj = fieldOptions.enum[0];
		const enumValues = fieldOptions.enum[1];

		metadata.collectEnumMetadata({
			enumObj,
			description: enumValues.description ?? `${enumObj}`,
			name: enumValues.name,
			valuesConfig: enumValues.valuesConfig ?? {},
		});
	}

	const UppercasedFieldName = fieldName[0].toUpperCase() + fieldName.slice(1);
	if (fieldOptions.generateFilter) {
		/**
		 * SORTING
		 * right now sorting by reference is not supported
		 */
		if (!isArray) {
			const orderByField = {
				target: GQLEntityOrderBy,
				name: fieldName,
				schemaName: fieldName,
				complexity: undefined,
				description: fieldName,
				deprecationReason: undefined,
				getType: () => Sort,
				options: { ...fieldOptions.options, nullable: true },
				typeOptions: { ...fieldOptions.options, nullable: true },
			} as FieldParameter;
			metadata.collectClassFieldMetadata(orderByField);
		}

		/**
		 * FILTERING
		 */
		const inputFieldName = `${gqlEntityName}_${UppercasedFieldName}`;
		@InputType(inputFieldName)
		class GQLEntityFilterInputField {
			@Field(() => [GQLEntityFilterInputField], {
				nullable: true,
				deprecationReason: 'this is the same as using an object with multiple values',
			})
			_and?: GQLEntityFilterInputField[];

			@Field(() => [GQLEntityFilterInputField], { nullable: true })
			_or?: GQLEntityFilterInputField[];

			@Field(() => [GQLEntityFilterInputField], { nullable: true })
			_not?: GQLEntityFilterInputField[];
		}
		Object.defineProperty(GQLEntityFilterInputField, 'name', {
			value: inputFieldName,
		});
		TypeMap[inputFieldName] = GQLEntityFilterInputField;

		const options: Array<{
			key: keyof typeof FieldOperations;
			array?: boolean;
			appliesToArray?: boolean;
		}> = [
			{ key: '_eq' },
			{ key: '_ne' },
			{ key: '_in', array: true },
			{ key: '_nin', array: true },
			{ key: '_gt' },
			{ key: '_gte' },
			{ key: '_lt' },
			{ key: '_lte' },
			{ key: '_like' },
			{ key: '_re' },
			{ key: '_ilike' },
			{ key: '_fulltext' },
			{ key: '_overlap', appliesToArray: true },
			{ key: '_contains', array: true, appliesToArray: true },
			{ key: '_contained' },
			{ key: '_exists' },
			{ key: '_between', array: true },
		];
		const canFilterForField = 'type' in fieldOptions;
		const includeNotArrays = !('relatedEntityName' in fieldOptions);
		// const includeAppliesToArray = 'array' in fieldOptions && fieldOptions.array;
		const getFilterType = 'getFilterType' in fieldOptions && fieldOptions.getFilterType;

		const applicableOptions = canFilterForField
			? options.filter(
					({ appliesToArray }) =>
						(!appliesToArray && includeNotArrays) || (appliesToArray && getFilterType)
			  )
			: [];

		if (canFilterForField && applicableOptions.length > 0) {
			for (const option of applicableOptions) {
				const optionGQLName = fieldName + option.key;
				const backCompFieldFilterOpt = {
					target: GQLEntityFilterInput,
					name: optionGQLName,
					schemaName: optionGQLName,
					getType: option.appliesToArray && getFilterType ? getFilterType : getType,
					options: {
						...fieldOptions.options,
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					typeOptions: {
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					complexity: undefined,
					description: optionGQLName,
					deprecationReason: undefined,
				} as FieldParameter;
				metadata.collectClassFieldMetadata(backCompFieldFilterOpt);

				const fieldFilterOpt = {
					target: GQLEntityFilterInputField,
					name: option.key,
					schemaName: option.key,
					getType: option.appliesToArray && getFilterType ? getFilterType : getType,
					options: {
						...fieldOptions.options,
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					typeOptions: {
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					complexity: undefined,
					description: option.key,
					deprecationReason: undefined,
				} as FieldParameter;
				metadata.collectClassFieldMetadata(fieldFilterOpt);
			}
		}
		if (!('relatedEntityName' in fieldOptions)) {
			const fieldFilterValue = {
				target: GQLEntityFilterInput,
				name: fieldName,
				schemaName: fieldName,
				getType: getType,
				options: fieldOptions.options,
				typeOptions: { nullable: true },
				complexity: undefined,
				description: fieldName,
				deprecationReason: undefined,
			} as FieldParameter;
			metadata.collectClassFieldMetadata(fieldFilterValue);
		}

		const fieldFilter = {
			target: GQLEntityFilterInput,
			name: UppercasedFieldName,
			schemaName: UppercasedFieldName,
			getType:
				'relatedEntityName' in fieldOptions
					? () => {
							return (
								TypeMap[getGQLEntityNameFor(fieldOptions.relatedEntityName()) + 'FilterInput'] ??
								GQLEntityFilterInputField
							);
					  }
					: () => GQLEntityFilterInputField,
			options: { ...fieldOptions.options, nullable: true },
			typeOptions: { nullable: true },
			complexity: undefined,
			description: fieldName,
			deprecationReason: undefined,
		} as FieldParameter;
		metadata.collectClassFieldMetadata(fieldFilter);

		if ('array' in fieldOptions) {
			const relatedEntityName = getGQLEntityNameFor(fieldOptions.relatedEntityName());

			metadata.collectHandlerParamMetadata({
				kind: 'arg',
				name: 'filter',
				description: undefined,
				methodName: fieldName,
				index: 0,
				getType: () => TypeMap[relatedEntityName + 'FilterInput'],
				target: GQLEntity,
				typeOptions: { nullable: true },
				deprecationReason: undefined,
				validateFn: undefined,
				validateSettings: undefined,
			});
			metadata.collectHandlerParamMetadata({
				kind: 'arg',
				name: 'pagination',
				description: undefined,
				methodName: fieldName,
				index: 1,
				getType: () => TypeMap[`${relatedEntityName}PaginationInput`],
				target: GQLEntity,
				typeOptions: { nullable: true },
				deprecationReason: undefined,
				validateFn: undefined,
				validateSettings: undefined,
			});
		}
	}
}
