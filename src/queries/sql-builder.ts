import { MappingsType } from '../types';

const USE_STRING = process.env.D3GOP_USE_STRING_FOR_JSONB === 'true';

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
	 * Generates a JSON object select statement for PostgreSQL
	 * @param json Array of JSON field definitions
	 * @param isMulti Whether to generate an array of objects (json_agg) or single object
	 * @returns SQL statement for JSON object construction
	 */
	public static generateJsonObjectSelectStatement(json: string[], isMulti = false): string {
		return isMulti
			? !USE_STRING
				? `coalesce(json_agg(jsonb_build_object(${json.join(', ')})), '[]'::json)`
				: `'['||coalesce(string_agg('{"' || ${json
						.map(jsonReducerForString)
						.join('||')} || '"}', ','), '') || ']'`
			: !USE_STRING
			? `jsonb_build_object(${json.join(', ')})`
			: `'{' || ${json.map(jsonReducerForString).join(' || ')} || '}'`;
	}

	/**
	 * Builds a subquery with proper joins and where conditions
	 * @param selectFields Fields to select
	 * @param tableName Table name
	 * @param alias Table alias
	 * @param globalFilterJoin Global filter joins
	 * @param globalWhereJoin Global where conditions
	 * @param value Optional additional conditions
	 * @returns SQL subquery string
	 */
	public static buildSubQuery(
		selectFields: string[],
		tableName: string,
		alias: string,
		globalFilterJoin: string[],
		globalWhereJoin: string[],
		value?: 
			| { filterJoin: string }
			| { where: string }
	): string {
		return `select ${selectFields.join(', ')} 
            from ${tableName} as ${alias}
            ${globalFilterJoin.join(' \n')}
			${value && 'filterJoin' in value ? value.filterJoin : ''}
		where true 
		${globalWhereJoin.length > 0 ? ` and ( ${globalWhereJoin.join(' and ')} )` : ''}
		${value && 'where' in value ? `and ${value.where}` : ''}`;
	}

	/**
	 * Builds UNION ALL queries for handling OR conditions
	 * @param fields Fields to select
	 * @param tableName Table name
	 * @param alias Table alias
	 * @param globalFilterJoin Global filter joins
	 * @param join Join conditions
	 * @param whereSQL Where conditions
	 * @param globalFilterWhere Global where conditions
	 * @param orConditions OR condition mappings
	 * @param queryBuilder Function to build individual queries
	 * @returns Array of SQL query strings for UNION ALL
	 */
	public static buildUnionAll(
		fields: string[],
		tableName: string,
		alias: string,
		globalFilterJoin: string[],
		join: string[],
		whereSQL: string,
		globalFilterWhere: string[],
		orConditions: MappingsType[],
		queryBuilder: (
			fields: string[],
			alias: string,
			tableName: string,
			filterJoin: string[],
			join: string[],
			whereSQL: string,
			whereWithValues: string[],
			value?:
				| { filterJoin: string }
				| { where: string }
		) => string
	): string[] {
		return orConditions
			.map(({ filterJoin: filterJoins, where: wheres }) => [
				...filterJoins.map((filterJ) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalFilterJoin,
						join,
						whereSQL,
						globalFilterWhere,
						{
							filterJoin: filterJ,
						}
					)
				),
				...wheres.map((w) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalFilterJoin,
						join,
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

	/**
	 * Builds ORDER BY SQL clause from pagination input
	 * @param orderBy Array of order by specifications
	 * @param fieldMapper Function to map field names to column names
	 * @returns SQL ORDER BY clause
	 */
	public static buildOrderBySQL(
		orderBy: Array<{ [key: string]: 'asc' | 'desc' }>,
		fieldMapper: (field: string) => string[]
	): string {
		if (!orderBy || orderBy.length === 0) {
			return '';
		}

		const orderClauses = orderBy
			.map((obs) =>
				Object.keys(obs)
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
		whereConditions: string,
		alias: string
	): string {
		return `left outer join lateral (
			select ${jsonSelect} as value 
			from ${fromSQL}
			${joins.join(' \n')}
			${whereConditions}
		) as ${alias} on true`.replaceAll(/[ \n\t]+/gi, ' ');
	}
}