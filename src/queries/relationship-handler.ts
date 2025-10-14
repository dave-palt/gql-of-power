import { Alias, AliasManager, AliasType } from './alias';
import { SQLBuilder } from './sql-builder';
import { EntityMetadata, EntityProperty, GQLEntityOrderByInputType, MappingsType, ReferenceType } from '../types';
import { logger } from '../variables';

export class RelationshipHandler {
	constructor(private aliasManager: AliasManager) {}

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
		filterJoin: string[],
		join: string[]
	): void {
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
			'RelationshipHandler - mapOneToX: field',
			referenceField.name,
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
			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);

			const isArray = fieldProps.reference !== ReferenceType.ONE_TO_ONE;
			const jsonSelect = SQLBuilder.generateJsonObjectSelectStatement(json, isArray);

			const onFields = Array.from(
				new Set(ons.map((on) => `${alias.toColumnName(on)}`).concat(Array.from(select)))
			);

			const processedOrderBy = this.processOrderBy(orderBy, referenceField, alias);
			const orderBySQL = processedOrderBy.length > 0 ? ` order by ${processedOrderBy.join(', ')} ` : '';
			const isNestedNeeded = offset || limit || processedOrderBy.length > 0;

			const fromSQL = `"${referenceField.tableName}" as ${alias.toString()}`;
			const subFromSQL = this.buildSubFromSQL(
				onFields,
				referenceField.tableName,
				alias,
				filterJoin,
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
				isNestedNeeded ? subFromSQL : fromSQL,
				join,
				whereConditions,
				alias.toString()
			);

			mapping.alias = alias;
			mapping.values = { ...mapping.values, ...values };
			mapping.join.push(leftOuterJoin);
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
		filterJoin: string[],
		limit: number | undefined,
		offset: number | undefined,
		gqlFieldName: string,
		select: Set<string>,
		json: string[],
		join: string[]
	): void {
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
				'filterJoin',
				filterJoin,
				limit,
				offset
			);

			mapping.select.add(
				`${fieldProps.fieldNames.map((fn) => parentAlias.toColumnName(fn)).join(', ')}`
			);
			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);

			const selectFields = [
				...new Set(ons.map((on) => alias.toColumnName(on)).concat(Array.from(select))),
			];

			const jsonSQL = SQLBuilder.generateJsonObjectSelectStatement(json);
			const fromSQL = `"${referenceField.tableName}" as ${alias.toString()}`;

			const whereConditions = `where ${where}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${limit && !isNaN(limit) ? `limit ${limit}` : ''}
				${offset && !isNaN(offset) ? `offset ${offset}` : ''}`;

			const leftOuterJoin = SQLBuilder.buildLateralJoin(
				jsonSQL,
				fromSQL,
				join,
				whereConditions,
				alias.toString()
			);

			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Handles Many-to-Many relationships
	 */
	public mapManyToMany(
		referenceField: EntityMetadata<any>,
		primaryKeys: string[],
		fieldProps: EntityProperty,
		parentAlias: Alias,
		alias: Alias,
		select: Set<string>,
		whereWithValues: string[],
		join: string[],
		json: string[],
		mapping: MappingsType,
		gqlFieldName: string,
		values: Record<string, any>,
		limit?: number,
		offset?: number,
		orderBy?: GQLEntityOrderByInputType<any>[]
	): void {
		const ons = fieldProps.joinColumns;
		if (primaryKeys.length !== ons.length) {
			throw new Error(
				`m:m joins with different number of columns ${primaryKeys.length} !== ${ons.length} on table ${referenceField.tableName}`
			);
		}
		if (referenceField.primaryKeys.length !== fieldProps.inverseJoinColumns.length) {
			throw new Error(
				`m:m joins with different number of columns ${referenceField.primaryKeys.length} !== ${fieldProps.inverseJoinColumns.length} on reference ${referenceField.tableName}.${fieldProps.pivotTable}`
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
		logger.log('RelationshipHandler - mapManyToMany', pivotTableWhereSQL, whereWithValues, join);

		if (pivotTableWhereSQL.length > 0) {
			const pivotTableSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
								from ${fieldProps.pivotTable}
								where ${pivotTableWhereSQL.join(' and ')}`;

			const jsonSQL = SQLBuilder.generateJsonObjectSelectStatement(json, true);
			const refAlias = alias.toString();

			const orderByClause = this.buildManyToManyOrderBy(orderBy, alias);

			const leftOuterJoin = `left outer join lateral (
			select ${jsonSQL} as value 
				from (
					select ${selectFields.join(', ')} 
						from "${referenceField.tableName}" as ${refAlias}
					where (${referenceField.primaryKeys.join(', ')})
						in (${pivotTableSQL})
						${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
						${orderByClause}
					${limit && !isNaN(limit) ? `limit ${limit}` : ''}
					${offset && !isNaN(offset) ? `offset ${offset}` : ''}
				) as ${refAlias}
				${join.join(' \n')}
			) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);
			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		} else {
			mapping.json.push(`'${gqlFieldName}', null`);
		}
	}

	private processOrderBy(
		orderBy: GQLEntityOrderByInputType<any>[],
		referenceField: EntityMetadata<any>,
		alias: Alias
	): string[] {
		return orderBy.reduce((acc, ob) => {
			Object.keys(ob).forEach((k: string) => {
				logger.log(
					'RelationshipHandler - processedOrderBy',
					k,
					ob[k],
					(referenceField as any).properties[k]
				);
				if (k in referenceField.properties) {
					acc.push(
						...referenceField.properties[
							k as keyof typeof referenceField.properties
						].fieldNames.map((fn) => `${alias.toColumnName(fn)} ${(ob as any)[k]}`)
					);
				}
			});
			return acc;
		}, [] as string[]);
	}

	private buildSubFromSQL(
		onFields: string[],
		tableName: string,
		alias: Alias,
		filterJoin: string[],
		where: string,
		whereWithValues: string[],
		orderBySQL: string,
		limit: number | undefined,
		offset: number | undefined
	): string {
		return `(
			select ${onFields.join(', ')}
				from "${tableName}" as ${alias.toString()}
				${filterJoin.join(' \n')}
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
				Object.keys(o ?? {})
					.map((column) => `${alias.toColumnName(column)} ${o[column]}`)
					.join(', ')
			)
			.join(', ');

		return orderClauses ? ` order by ${orderClauses}` : '';
	}
}