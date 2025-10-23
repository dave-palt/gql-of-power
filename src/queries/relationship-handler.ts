import {
	EntityMetadata,
	EntityProperty,
	GQLEntityOrderByInputType,
	MappingsType,
	mappingsTypeToString,
	ReferenceType,
} from '../types';
import { keys } from '../utils';
import { logger } from '../variables';
import { Alias } from './alias';
import { SQLBuilder } from './sql-builder';

export class RelationshipHandler {
	constructor() {}

	/**
	 * Handles One-to-Many and One-to-One relationships
	 */
	public mapOneToX(
		referenceField: EntityMetadata<any>,
		fieldProps: EntityProperty,
		mapping: MappingsType,
		parentAlias: Alias,
		alias: Alias,
		whereWithValues: string[],
		values: Record<string, any>,
		limit: number | undefined,
		offset: number | undefined,
		orderBy: GQLEntityOrderByInputType<any>[],
		gqlFieldName: string,
		json: string[],
		select: Set<string>,
		innerJoin: string[],
		join: string[]
	): void {
		const prefix = 'RelationshipHandler - mapOneToX';
		logger.log(prefix);
		const referenceFieldProps = referenceField.properties[
			fieldProps.mappedBy as keyof typeof referenceField.properties
		] as EntityProperty;

		const ons = referenceFieldProps.joinColumns;
		const entityOns = referenceFieldProps.referencedColumnNames;

		if (ons.length !== entityOns.length) {
			throw new Error(
				`joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}. Entity: ${referenceField.name}, Table: ${referenceField.tableName}`
			);
		}

		const where = entityOns
			.map((o, i) => {
				return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
			})
			.join(' and ');

		logger.log(
			prefix,
			'field',
			referenceField.name,
			{ where },
			'whereSQL',
			whereWithValues,
			'values',
			values,
			'limit',
			limit,
			'offset',
			offset,
			'orderBy',
			orderBy
		);

		if (referenceField.tableName && where.length > 0) {
			mapping.json.push(`${alias.toColumnName('value')} as "${gqlFieldName}"`);

			const isArray = fieldProps.reference !== ReferenceType.ONE_TO_ONE;
			const jsonSelect = SQLBuilder.generateJsonSelectStatement(alias.toString(), isArray);

			const onFields = Array.from(
				new Set(ons.map((on) => `${alias.toColumnName(on)}`).concat(Array.from(select)))
			);

			const orderBySQL = SQLBuilder.buildOrderBySQL(
				orderBy,
				SQLBuilder.getFieldMapper(referenceField, alias)
			);
			const isNestedNeeded = isArray || offset || limit || orderBySQL.length > 0;

			// const fromSQL = `"${referenceField.tableName}" as ${alias.toString()}`;
			const subFromSQL = this.buildSubFromSQL(
				onFields,
				referenceField.tableName,
				alias,
				innerJoin,
				where,
				whereWithValues,
				orderBySQL,
				limit,
				offset
			);

			const whereConditions = isNestedNeeded
				? ''
				: `
			where ${where}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${orderBySQL}
				${limit && !isNaN(limit) ? `limit ${limit}` : ''}
				${offset && !isNaN(offset) ? `offset ${offset}` : ''}`;

			const leftOuterJoin = SQLBuilder.buildLateralJoin(
				jsonSelect,
				subFromSQL,
				join,
				whereConditions,
				alias.toString()
			);

			logger.log(
				prefix,
				'field',
				referenceField.name,
				alias.toString(),
				{ isNestedNeeded },
				{ subFromSQL },
				{ leftOuterJoin },
				{ whereConditions },
				{ orderBySQL }
			);
			mapping.alias = alias;
			mapping.values = { ...mapping.values, ...values };
			mapping.outerJoin.push(leftOuterJoin);
		}
	}

	/**
	 * Handles Many-to-One relationships
	 */
	public mapManyToOne(
		fieldProps: EntityProperty,
		referenceField: EntityMetadata<any>,
		parentAlias: Alias,
		alias: Alias,
		mapping: MappingsType,
		whereWithValues: string[],
		values: Record<string, any>,
		innerJoin: string[],
		limit: number | undefined,
		offset: number | undefined,
		gqlFieldName: string,
		select: Set<string>,
		json: string[],
		join: string[]
	): void {
		logger.log('RelationshipHandler - mapManyToOne');
		if (fieldProps.fieldNames.length !== referenceField.primaryKeys.length) {
			throw new Error(
				`Mismatch in lengths: fieldProps.fieldNames (${fieldProps.fieldNames.length}) and referenceField.primaryKeys (${referenceField.primaryKeys.length}) must have the same length.`
			);
		}

		if (fieldProps.fieldNames.length && referenceField.tableName) {
			const ons = referenceField.primaryKeys;
			const entityOns = fieldProps.fieldNames;

			const where = entityOns
				.map((o, i) => {
					return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
				})
				.join(' and ');

			logger.log(
				'RelationshipHandler - mapManyToOne: whereSQL',
				referenceField.name,
				alias.toString(),
				parentAlias.toString(),
				'where',
				whereWithValues,
				'values',
				values,
				'innerJoin',
				innerJoin,
				limit,
				offset
			);

			mapping.select.add(
				`${fieldProps.fieldNames.map((fn) => parentAlias.toColumnName(fn)).join(', ')}`
			);
			mapping.rawSelect.add(`${fieldProps.fieldNames.join(', ')}`);
			mapping.json.push(`${alias.toColumnName('value')} as "${gqlFieldName}"`);

			const selectFields = [
				...new Set(ons.map((on) => alias.toColumnName(on)).concat(Array.from(select))),
			];

			const jsonSQL = SQLBuilder.generateJsonSelectStatement(alias.toString());

			const subFromSQL = this.buildSubFromSQL(
				selectFields,
				referenceField.tableName,
				alias,
				innerJoin,
				where,
				whereWithValues,
				'',
				limit,
				offset
			);

			const whereConditions = `where ${where}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${limit && !isNaN(limit) ? `limit ${limit}` : ''}
				${offset && !isNaN(offset) ? `offset ${offset}` : ''}`;

			const leftOuterJoin = SQLBuilder.buildLateralJoin(
				jsonSQL,
				subFromSQL,
				join,
				whereConditions,
				alias.toString()
			);

			mapping.outerJoin.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Handles Many-to-Many relationships
	 */
	public mapManyToMany(
		fieldMetadata: EntityMetadata<any>,
		primaryKeys: string[],
		fieldProps: EntityProperty,
		parentAlias: Alias,
		alias: Alias,
		select: Set<string>,
		whereWithValues: string[],
		outerJoin: string[],
		json: string[],
		mapping: MappingsType,
		gqlFieldName: string,
		values: Record<string, any>,
		limit?: number,
		offset?: number,
		orderBy?: GQLEntityOrderByInputType<any>[]
	): void {
		logger.log('RelationshipHandler - mapManyToMany');
		const ons = fieldProps.joinColumns;
		if (primaryKeys.length !== ons.length) {
			throw new Error(
				`m:m joins with different number of columns ${primaryKeys.length} !== ${ons.length} on table ${fieldMetadata.tableName}`
			);
		}
		if (fieldMetadata.primaryKeys.length !== fieldProps.inverseJoinColumns.length) {
			throw new Error(
				`m:m joins with different number of columns ${fieldMetadata.primaryKeys.length} !== ${fieldProps.inverseJoinColumns.length} on reference ${fieldMetadata.tableName}.${fieldProps.pivotTable}`
			);
		}

		const pivotTableWhereSQL = primaryKeys.map((o, i) => {
			return `${parentAlias.toColumnName(o)} = ${fieldProps.pivotTable}.${ons[i]}`;
		});

		const selectFields = [...select];
		logger.log(
			'RelationshipHandler - mapManyToMany selectFields',
			selectFields,
			limit,
			offset,
			orderBy
		);
		logger.log(
			'RelationshipHandler - mapManyToMany',
			pivotTableWhereSQL,
			whereWithValues,
			outerJoin
		);

		logger.log(
			'RelationshipHandler - mapManyToMany - leftOuterJoin',
			[...select.entries()],
			mappingsTypeToString(mapping, true)
		);

		if (pivotTableWhereSQL.length > 0) {
			const pivotTableSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
								from ${fieldProps.pivotTable}
								where ${pivotTableWhereSQL.join(' and ')}`;

			const jsonSQL = SQLBuilder.generateJsonSelectStatement(alias.toString(), true);
			const refAlias = alias.toString();

			const orderByClause = SQLBuilder.buildOrderBySQL(
				orderBy,
				SQLBuilder.getFieldMapper(fieldMetadata, alias)
			);

			const leftOuterJoin = `left outer join lateral (
			select ${jsonSQL} as value 
				from (
					select ${selectFields.join(', ')} 
						from "${fieldMetadata.tableName}" as ${refAlias}
					where (${fieldMetadata.primaryKeys.join(', ')})
						in (${pivotTableSQL})
						${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
						${orderByClause}
					${limit && !isNaN(limit) ? `limit ${limit}` : ''}
					${offset && !isNaN(offset) ? `offset ${offset}` : ''}
				) as ${refAlias}
				${outerJoin.join(' \n')}
			) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.json.push(`${alias.toColumnName('value')} as "${gqlFieldName}"`);
			mapping.outerJoin.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };

			logger.log(
				'RelationshipHandler - mapManyToMany - leftOuterJoin',
				mappingsTypeToString(mapping, true)
			);
		} else {
			mapping.json.push(`'${gqlFieldName}', null`);
		}
	}

	private buildSubFromSQL(
		onFields: string[],
		tableName: string,
		alias: Alias,
		innerJoin: string[],
		where: string,
		whereWithValues: string[],
		orderBySQL: string,
		limit: number | undefined,
		offset: number | undefined
	): string {
		return `(
			select ${onFields.join(', ')}
				from "${tableName}" as ${alias.toString()}
				${innerJoin.join(' \n')}
			where ${where}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${orderBySQL}
				${limit && !isNaN(limit) ? `limit ${limit}` : ''}
				${offset && !isNaN(offset) ? `offset ${offset}` : ''}
		) as ${alias.toString()}`;
	}

	private buildManyToManyOrderBy(
		orderBy: GQLEntityOrderByInputType<any>[] | undefined,
		alias: Alias
	): string {
		if (!orderBy || orderBy.length === 0) {
			return '';
		}

		const orderClauses = orderBy
			.map((o) =>
				keys(o ?? {})
					.map((column) => `${alias.toColumnName(column)} ${o[column]}`)
					.join(', ')
			)
			.join(', ');

		return orderClauses ? ` order by ${orderClauses}` : '';
	}
}
