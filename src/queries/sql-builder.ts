import { getFieldByAlias } from '../entities';
import { EntityMetadata, GQLEntityOrderByInputType, MappingsType } from '../types';
import { keys } from '../utils';
import { Alias } from './alias';

const jsonReducerForString = (
	/**
	 * `'id', `
	 */
	j: string,
	index: number
): string => {
	const [key, value] = j.split(',');
	return `'${index > 0 ? ',' : ''}${key.replaceAll(
		/[']/gi,
		'"'
	)}:' || coalesce(${value}::text, '""')`;
};

export class SQLBuilder {
	/**
	 * Generates a SQL select statement for converting query results to JSON format.
	 *
	 * @param alias - The table or subquery alias to be converted to JSON.
	 * @param isMulti - If true, generates a statement for aggregating multiple rows into a JSON array;
	 *                  if false, generates a statement for a single row as a JSON object.
	 * @returns A SQL string that uses either `row_to_json` for a single row or `json_agg(row_to_json(...))` for multiple rows.
	 */
	public static generateJsonSelectStatement = (alias: string, isMulti = false) =>
		isMulti ? `coalesce(json_agg(row_to_json(${alias})), '[]'::json)` : `row_to_json(${alias})`;
	/**
	 * Builds a subquery with proper joins and where conditions
	 * @param selectFields Fields to select
	 * @param tableName Table name
	 * @param alias Table alias
	 * @param globalInnerJoin Global filter joins
	 * @param globalWhereJoin Global where conditions
	 * @param value Optional additional conditions
	 * @returns SQL subquery string
	 */
	public static buildSubQuery(
		selectFields: string[],
		rawSelect: string[],
		tableName: string,
		alias: Alias,
		globalInnerJoin: string[],
		globalOuterJoin: string[],
		globalWhereJoin: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select ${selectFields.join(', ')}
            from (
				select ${rawSelect.join(', ')}
					from ${tableName} as ${alias}
					${globalInnerJoin.join(' \n')}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
				where true 
				${globalWhereJoin.length > 0 ? ` and ( ${globalWhereJoin.join(' and ')} )` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}
			) as ${alias}
			${globalOuterJoin.join(' \n')}`;
	}

	/**
	 * Builds UNION ALL queries for handling OR conditions
	 * @param fields Fields to select
	 * @param tableName Table name
	 * @param alias Table alias
	 * @param globalInnerJoin Global filter joins
	 * @param outerJoin Join conditions
	 * @param whereSQL Where conditions
	 * @param globalFilterWhere Global where conditions
	 * @param orConditions OR condition mappings
	 * @param queryBuilder Function to build individual queries
	 * @returns Array of SQL query strings for UNION ALL
	 */
	public static buildUnionAll(
		fields: string[],
		tableName: string,
		alias: Alias,
		globalInnerJoin: string[],
		outerJoin: string[],
		whereSQL: string,
		globalFilterWhere: string[],
		orConditions: MappingsType[],
		queryBuilder: (
			fields: string[],
			alias: Alias,
			tableName: string,
			innerJoin: string[],
			join: string[],
			whereSQL: string,
			whereWithValues: string[],
			value?: { innerJoin: string } | { where: string }
		) => string
	): string[] {
		return orConditions
			.map(({ innerJoin: innerJoins, where: wheres }) => [
				...innerJoins.map((filterJ) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalInnerJoin,
						outerJoin,
						whereSQL,
						globalFilterWhere,
						{
							innerJoin: filterJ,
						}
					)
				),
				...wheres.map((w) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalInnerJoin,
						outerJoin,
						whereSQL,
						globalFilterWhere,
						{
							where: w,
						}
					)
				),
			])
			.flat();
	}
	public static getFieldMapper =
		<T>(metadata: EntityMetadata<T>, alias: Alias) =>
		(ob: string) => {
			const fieldMeta = metadata.properties[ob];

			if (!fieldMeta) {
				throw new Error('Unknown pagination field ' + ob + ' for table ' + metadata.tableName);
			}
			return fieldMeta.fieldNames.map((fn) => {
				const fieldName = getFieldByAlias(fieldMeta.name, fn);
				return `${alias.toColumnName(fieldName) ?? fieldName}`;
			});
		};
	/**
	 * Builds ORDER BY SQL clause from pagination input
	 * @param orderBy Array of order by specifications
	 * @param fieldMapper Function to map field names to column names
	 * @returns SQL ORDER BY clause
	 */
	public static buildOrderBySQL(
		orderBy: GQLEntityOrderByInputType<any>[] | undefined,
		fieldMapper: (field: string) => string[]
	): string {
		if (!orderBy || orderBy.length === 0) {
			return '';
		}

		const orderClauses = orderBy
			.map((obs) =>
				keys(obs)
					.map((ob) =>
						fieldMapper(ob)
							.map((fn) => `${fn} ${obs[ob]}`)
							.join(', ')
					)
					.filter((o) => o.length > 0)
					.join(', ')
			)
			.filter((o) => o.length > 0)
			.join(', ');

		return orderClauses ? `order by ${orderClauses}` : '';
	}

	/**
	 * Builds a lateral join SQL for one-to-many or many-to-one relationships
	 * @param jsonSelect JSON selection SQL
	 * @param fromSQL From clause SQL
	 * @param joins Array of join clauses
	 * @param whereConditions Where conditions
	 * @param alias Table alias
	 * @returns Lateral join SQL
	 */
	public static buildLateralJoin(
		jsonSelect: string,
		fromSQL: string,
		joins: string[],
		alias: string
	): string {
		return `left outer join lateral (
			select ${jsonSelect} as value 
			from ${fromSQL}
			${joins.join(' \n')}
		) as ${alias} on true`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Builds a many-to-many pivot table query
	 * @param fieldNames Fields to select
	 * @param alias Table alias
	 * @param tableName Table name
	 * @param innerJoin Filter join conditions
	 * @param join Join conditions
	 * @param whereSQL Where conditions
	 * @param whereWithValues Where conditions with values
	 * @param value Optional additional conditions
	 * @returns Many-to-many pivot table SQL
	 */
	public static buildManyToManyPivotTable(
		fieldNames: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select ${fieldNames.join(', ')} 
					from ${tableName} as ${alias.toString()}
						${join.join(' \n')}
						${value && 'innerJoin' in value ? value.innerJoin : ''}
						${innerJoin.join(' \n')}
				${whereSQL.length > 0 ? ` where ${whereSQL}` : ''}
				${whereWithValues.length > 0 ? ` and ${whereWithValues.join(' and ')}` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Builds a many-to-one join query
	 * @param fields Fields to select
	 * @param alias Table alias
	 * @param tableName Table name
	 * @param innerJoin Filter join conditions
	 * @param join Join conditions
	 * @param whereSQL Where conditions
	 * @param whereWithValues Where conditions with values
	 * @param value Optional additional conditions
	 * @returns Many-to-one join SQL
	 */
	public static buildManyToOneJoin(
		fields: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select ${alias.toColumnName('*')} 
					from "${tableName}" as ${alias}
					${innerJoin.join(' \n')}
					${join.join(' \n')}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
				where ${whereSQL} 
				${whereWithValues.length > 0 ? ' and ' : ''}
				${whereWithValues.join(' and ')}
				${value && 'where' in value ? `and ${value.where}` : ''}`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Builds a one-to-many join query
	 * @param fields Fields to select
	 * @param alias Table alias
	 * @param tableName Table name
	 * @param innerJoin Filter join conditions
	 * @param join Join conditions
	 * @param whereSQL Where conditions
	 * @param whereWithValues Where conditions with values
	 * @param value Optional additional conditions
	 * @returns One-to-many join SQL
	 */
	public static buildOneToXJoin(
		fields: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select ${alias.toColumnName('*')} 
					from "${tableName}" as ${alias}
					${innerJoin.join(' \n')}
					${join.join(' \n')}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
				where ${whereSQL} 
				${whereWithValues.length > 0 ? ' and ' : ''}
				${whereWithValues.join(' and ')}
				${value && 'where' in value ? `and ${value.where}` : ''}
				`.replaceAll(/[ \n\t]+/gi, ' ');
	}
}
