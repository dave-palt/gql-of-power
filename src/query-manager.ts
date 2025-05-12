import { GraphQLResolveInfo } from "graphql";
import graphqlFields from "graphql-fields";
import { Database, logger } from ".";
import { CustomFieldsMap } from "./entities/mappings";
import { mappingsReducer, recursiveMap } from "./queries/mapper";
import {
  Fields,
  GQLEntityFilterInputFieldType,
  GQLEntityPaginationInputType,
} from "./types";

export const getQueryResultsFor = async <K extends { _____name: string }, T>(
  entity: new () => T,
  info: GraphQLResolveInfo,
  filter?: GQLEntityFilterInputFieldType<T>,
  pagination?: Partial<GQLEntityPaginationInputType<T>>
): Promise<K[]> => {
  if (!Database.em.getMetadata().has(entity.name)) {
    throw new Error(`Entity ${entity.name} not found in metadata`);
  }
  const fields = graphqlFields(
    info,
    {},
    { processArguments: true }
  ) as Fields<T>;

  const customFields = CustomFieldsMap[entity.name] ?? {};

  const alias = "a0";
  const metadata = Database.em.getMetadata().get(entity.name);
  logger.fatal("recursiveMap start");
  const { select, json, filterJoin, join, where, values } = mappingsReducer(
    recursiveMap<T>(
      metadata,
      fields,
      0,
      alias,
      filter ? [filter] : [],
      undefined,
      customFields
    )
  );
  logger.fatal("recursiveMap done");
  const orderByFields = (pagination?.orderBy ?? [])
    .map((obs) =>
      Object.keys(obs)
        .map((ob) => `${alias}.${ob}`)
        .flat()
    )
    .flat();

  const orderBySQL = pagination?.orderBy
    ? `order by ${pagination.orderBy
        .map((obs) =>
          Object.keys(obs)
            .map((ob) =>
              metadata.properties[ob].fieldNames
                .map((fn) => `${alias}.${fn} ${(obs as any)[ob]}`)
                .join(", ")
            )
            .filter((o) => o.length > 0)
            .join(", ")
        )
        .filter((o) => o.length > 0)
        .join(", ")}`
    : ``;
  logger.fatal("orderByFields", orderByFields, "select", select);
  const selectFields = [...new Set(orderByFields.concat(Array.from(select)))];
  const subQuery2 = `select ${selectFields.join(", ")} 
            from ${metadata.tableName} as ${alias}
            ${filterJoin.join(" \n")}
                where true 
                ${where.length > 0 ? " and " : ""}
                ${where.join(" and ")}
            ${orderBySQL}
                ${pagination?.limit ? `limit :limit` : ``}
                ${pagination?.offset ? `offset :offset` : ``}
    `;

  const selectFieldsSQL = Array.from(orderByFields);
  selectFieldsSQL.push(`jsonb_build_object(${json.join("\n, ")}) as val`);

  const res = await Database.em.execute<Array<{ val: T }>>(
    Database.em.raw(
      `select ${selectFieldsSQL.join(", ")}
            from (${subQuery2}) as ${alias}
            ${join.join(" \n")}
            ${orderBySQL}
    `,
      {
        ...values,
        limit: 3000,
        ...(pagination?.limit ? { limit: pagination.limit } : {}),
        ...(pagination?.offset ? { offset: pagination.offset } : {}),
      }
    )
  );
  logger.fatal("res", res.length);
  const mapped = res.map(({ val }) => {
    // for (const key of customFieldsKeys) {
    // 	const conf = (customFields as any)[key];
    // 	Object.defineProperty(val, key, {
    // 		get: () => conf.resolve(val),
    // 		enumerable: true,
    // 		configurable: true,
    // 	});
    // }

    return val as any as K;
  });
  logger.fatal("mapped finished");
  return mapped;
};
