import { getFieldByAlias } from '../entities/gql-entity';
import { EntityMetadata } from '../types/sql-types';
import { GQLEntityOrderByInputType } from '../types/gql-types';
import { MappingsType } from '../types/gql-to-sql-types';
import { keys } from '../utils/object';
import { Alias } from './alias';

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
		isMulti
			? `coalesce(json_agg(row_to_json(${alias}))::json, '[]'::json)::jsonb`
			: `row_to_json(${alias})::jsonb`;
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
		value?: { innerJoin: string } | { where: string },
		innerOrderBy?: string,
		innerLimit?: string,
		innerOffset?: string
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
				${innerOrderBy ?? ''}
				${innerLimit ?? ''}
				${innerOffset ?? ''}
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
			.map(({ innerJoin: innerJoins, where: wheres }) => {
				if (wheres.length === 0 && innerJoins.length === 0) {
					return null;
				}

				const combinedInnerJoin = [...globalInnerJoin, ...innerJoins];
				const combinedWhere = [...globalFilterWhere, ...wheres];

				return queryBuilder(
					fields,
					alias,
					tableName,
					combinedInnerJoin,
					outerJoin,
					whereSQL,
					combinedWhere
				);
			})
			.filter((q): q is string => q !== null);
	}
	public static buildInnerBranch(
		rawSelect: string[],
		tableName: string,
		alias: Alias,
		innerJoin: string[],
		whereConditions: string[]
	): string {
		return `select ${rawSelect.join(', ')}
			from ${tableName} as ${alias}
			${innerJoin.join(' \n')}
		where true 
		${whereConditions.length > 0 ? ` and ( ${whereConditions.join(' and ')} )` : ''}`.replaceAll(
			/[ \n\t]+/gi,
			' '
		);
	}

	/**
	 * Builds a SQL CASE expression that maps a raw DB enum column value to its
	 * enum string key (name). Used for `mapNumericEnum` fields so the query
	 * returns the GraphQL-ready string directly — no post-query conversion.
	 *
	 * Iterates the enum object's keys. Numeric-valued keys produce a numeric
	 * WHEN branch; string-valued keys produce a quoted-string WHEN branch.
	 *
	 * Example output:
	 *   CASE "a1"."state"
	 *     WHEN 0 THEN 'NotStarted'
	 *     WHEN 1 THEN 'InProgress'
	 *     ELSE NULL
	 *   END
	 *
	 * @param columnExpr Raw SQL column expression (e.g. `"a1"."state"`)
	 * @param enumObj   The TypeScript enum object (e.g. `QuestState`)
	 * @returns CASE WHEN ... THEN ... END expression, or null if no values
	 */
	public static buildEnumCaseSQL(columnExpr: string, enumObj: Record<string, any>): string | null {
		const branches: string[] = [];
		for (const key of Object.keys(enumObj)) {
			// Skip TypeScript's numeric reverse-mapping entries
			if (/^\d+$/.test(key)) continue;

			const val = enumObj[key];
			const sqlVal = typeof val === 'number' ? val : `'${String(val).replace(/'/g, "''")}'`;
			branches.push(`WHEN ${sqlVal} THEN '${key}'`);
		}
		if (branches.length === 0) return null;
		return `CASE ${columnExpr} ${branches.join(' ')} ELSE NULL END`;
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
		alias: string,
		jsonColumns: string[] = []
	): string {
		if (joins.length > 0 && jsonColumns.length > 0) {
			const innerBody = `( select ${alias}.*, ${jsonColumns.join(', ')} from ${fromSQL} ${joins.join(' \n')} ) as ${alias}`;
			return `left outer join lateral ( select ${jsonSelect} as value from ${innerBody} ) as ${alias} on true`.replaceAll(
				/[ \n\t]+/gi,
				' '
			);
		}
		return `left outer join lateral (
			select ${jsonSelect} as value
			from ${fromSQL}
			${joins.join(' \n')}
		) as ${alias} on true`.replaceAll(/[ \n\t]+/gi, ' ');
	}
}
