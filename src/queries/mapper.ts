import { EntityMetadata, ReferenceType } from "@mikro-orm/core";
import { Database, logger } from "..";
import { ClassOperations, FieldOperations } from "../operations";
import {
  CustomFieldsSettings,
  Fields,
  GQLEntityFilterInputFieldType,
  GQLEntityOrderByInputType,
  MappingsType,
} from "../types";
import { parseEqFilter } from "./eq-filter";

const newMappings = (startAlias = 0) =>
  ({
    select: new Set<string>(),
    json: [] as string[],
    filterJoin: [] as string[],
    join: [] as string[],
    where: [] as string[],
    values: {} as Record<string, any>,
    orderBy: [] as GQLEntityOrderByInputType<any>[],
    alias: startAlias,
  } as MappingsType);

const mappingsReducer = (m: Map<string, MappingsType>) =>
  Array.from(m.values()).reduce(
    (
      {
        select,
        filterJoin,
        json,
        join,
        where,
        values,
        limit,
        offset,
        orderBy,
        alias,
      },
      mapping
    ) => {
      mapping.select.forEach((s) => select.add(s));
      json.push(...mapping.json);
      filterJoin.push(...mapping.filterJoin);
      join.push(...mapping.join);
      where.push(...mapping.where);
      mapping.orderBy && orderBy.push(...mapping.orderBy);
      values = { ...values, ...mapping.values };

      return {
        select,
        json,
        filterJoin,
        join,
        where,
        values,
        limit: mapping.limit ?? limit,
        offset: mapping.offset ?? offset,
        orderBy,
        alias: alias > mapping.alias ? alias : mapping.alias,
      };
    },
    newMappings(-1)
  );
export const recursiveMap = <T>(
  entityMetadata: EntityMetadata<T>,
  fields: Fields<T> | any,
  startAlias = 0,
  alias: string,
  gqlFilters: Array<GQLEntityFilterInputFieldType<T>>,
  prefix?: string,
  customFields?: CustomFieldsSettings<T>
  // orderBy?: Array<GQLEntityOrderByInputType<T>>
) => {
  // const alias = `${startAlias}`;
  logger.fatal("recursiveMap startAlias", startAlias, alias, gqlFilters);
  const { properties, primaryKeys } = entityMetadata;

  let aliasNumber = startAlias;

  let res = [...new Set(Object.keys(fields))].reduce(
    (mappings, gqlFieldNameKey, i) => {
      const fieldPrefix = `${prefix ?? ""}_${i}`;
      if (gqlFieldNameKey.startsWith("__")) {
        if (gqlFieldNameKey === "__arguments") {
          const __arguments = fields[gqlFieldNameKey];

          const m = newMappings(aliasNumber);

          const filter = __arguments.find((a: any) => a?.filter)?.filter?.value;
          const pagination = __arguments.find((a: any) => a?.pagination)
            ?.pagination?.value;
          logger.fatal(
            "__arguments ====> ",
            __arguments,
            "filter",
            filter,
            "pagination",
            pagination
          );
          if (filter || pagination) {
            const {
              filterJoin,
              where: w,
              values,
              alias: newAlias,
            } = mappingsReducer(
              recursiveMap(
                entityMetadata,
                [],
                aliasNumber + 1,
                alias,
                [filter],
                fieldPrefix
              )
            );
            m.filterJoin.push(...filterJoin);
            m.where.push(...w);
            m.values = { ...m.values, ...values };
            m.limit = pagination?.limit;
            m.offset = pagination?.offset;
            m.orderBy = pagination?.orderBy;
            m.alias = newAlias;
            aliasNumber = newAlias;
          } else {
            // m.__arguments = __arguments;
          }
          mappings.set(gqlFieldNameKey, m);
        }
        return mappings;
      }
      if (!mappings.has(gqlFieldNameKey)) {
        mappings.set(gqlFieldNameKey, newMappings(aliasNumber + 1));
      }
      const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();

      const customFieldProps =
        customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>];

      const fieldProps =
        properties[gqlFieldNameKey as keyof EntityMetadata<T>["properties"]] ??
        properties[
          customFieldProps?.requires as keyof EntityMetadata<T>["properties"]
        ];

      const gqlFieldName =
        (customFieldProps?.requires as string) ?? gqlFieldNameKey;

      if (!fieldProps) {
        logger.fatal(
          alias,
          gqlFieldName,
          "not found in properties nor in customFields"
        );
        return mappings;
      }
      const referenceField =
        Database.em.getMetadata().has(fieldProps.type) &&
        Database.em.getMetadata().get(fieldProps.type);

      // logger.fatal(gqlFieldName, 'fieldNames', fieldProps.fieldNames);

      const uniqueFieldNames = (fieldProps.fieldNames ?? []).map(
        (f) => `${alias}.${f}`
      );

      if (referenceField) {
        const refAlias = `${fieldPrefix}_${alias}_${i}`;
        // logger.fatal('referenceField', referenceField.name, fieldProps.reference);

        if (
          fieldProps.reference === ReferenceType.ONE_TO_MANY ||
          fieldProps.reference === ReferenceType.ONE_TO_ONE
        ) {
          const referenceFieldProps =
            referenceField.properties[fieldProps.mappedBy];
          // logger.fatal('referenceFieldProps', referenceField.name, referenceFieldProps.mappedBy);

          const ons = referenceFieldProps.joinColumns;
          const entityOns = referenceFieldProps.referencedColumnNames;

          if (ons.length !== entityOns.length) {
            throw new Error(
              `joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}`
            );
          }

          const where = entityOns
            .map((o, i) => {
              return `${alias}.${o} = ${refAlias}.${ons[i]}`;
            })
            .join(", ");

          const {
            select,
            json,
            join,
            filterJoin,
            where: fieldWhere,
            values: fieldWhereValues,
            limit,
            offset,
            orderBy,
            alias: newAlias,
          } = mappingsReducer(
            recursiveMap(
              referenceField,
              fields[gqlFieldName],
              aliasNumber + 1,
              refAlias,
              [],
              `${refAlias}_${i}`
            )
          );
          mapping.alias = newAlias;

          aliasNumber = newAlias;

          logger.fatal(
            "recursiveMap - referenceField",
            referenceField.name,
            "where",
            fieldWhere,
            "values",
            fieldWhereValues,
            "limit",
            limit,
            "offset",
            offset,
            "orderBy",
            orderBy
          );
          if (referenceField.tableName && where.length > 0) {
            mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);

            const jsonSelect =
              fieldProps.reference === ReferenceType.ONE_TO_ONE
                ? `jsonb_build_object(${json.join(", ")})`
                : `coalesce(json_agg(jsonb_build_object(${json.join(
                    ", "
                  )})), '[]'::json)`;

            const onFields = Array.from(
              new Set(
                ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select))
              )
            );

            const processedOrderBy = orderBy.reduce((acc, ob) => {
              Object.keys(ob).forEach((k: string) => {
                logger.fatal(
                  "recursiveMap - processedOrderBy",
                  k,
                  ob[k],
                  (referenceField as any).properties[k]
                );
                if (k in referenceField.properties) {
                  acc.push(
                    ...referenceField.properties[
                      k as keyof (typeof referenceField)["properties"]
                    ].fieldNames.map(
                      (fn) => `${refAlias}.${fn} ${(ob as any)[k]}`
                    )
                  );
                }
              });
              return acc;
            }, [] as string[]);
            const orderBySQL =
              processedOrderBy.length > 0
                ? ` order by ${processedOrderBy.join(", ")} `
                : "";

            const fromSQL = `${orderBySQL ? "( select * from " : ""}${
              referenceField.tableName
            }${orderBySQL ? ` as ${refAlias} ${orderBySQL} )` : ""}`;
            const leftOuterJoin = `left outer join lateral (
                                select ${jsonSelect} as value from (
                                    select ${onFields.join(", ")} 
                                        from ${fromSQL} as ${refAlias}
                                    ${filterJoin.join(" \n")}
                                    where ${where}
                                    ${fieldWhere.length > 0 ? " and " : ""} 
                                    ${fieldWhere.join(" and ")}
                                    ${
                                      limit && !isNaN(limit)
                                        ? `limit ${limit}`
                                        : ""
                                    }
                                    ${
                                      offset && !isNaN(offset)
                                        ? `offset ${offset}`
                                        : ""
                                    }
                            ) as ${refAlias} 
                            ${join.join(" \n")}
                            ) as ${refAlias} on true`.replaceAll(
              /[ \n\t]+/gi,
              " "
            );

            mapping.values = { ...mapping.values, ...fieldWhereValues };
            mapping.join.push(leftOuterJoin);
          }
        } else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
          if (fieldProps.fieldNames.length && referenceField.tableName) {
            const ons = referenceField.primaryKeys;
            const entityOns = fieldProps.fieldNames;

            const where = entityOns
              .map((o, i) => {
                return `${alias}.${o} = ${refAlias}.${ons[i]}`;
              })
              .join(", ");

            const {
              select,
              json,
              join,
              where: w,
              values,
              alias: newAlias,
            } = mappingsReducer(
              recursiveMap(
                referenceField,
                fields[gqlFieldName],
                aliasNumber + 1,
                refAlias,
                [],
                `${refAlias}_${i}`
              )
            );

            mapping.select.add(`${fieldProps.fieldNames.join(", ")}`);
            mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);
            mapping.alias = newAlias;
            aliasNumber = newAlias;

            const selectFields = [
              ...new Set(
                ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select))
              ),
            ];
            const leftOuterJoin = `left outer join lateral (
                                select jsonb_build_object(${json.join(
                                  ", "
                                )}) as value from (
                                    select ${selectFields.join(", ")} from ${
              referenceField.tableName
            } as ${refAlias}
                                    where ${where}
                            ) as ${refAlias}
                            ${join.join(" \n")}
                            ) as ${refAlias} on true`.replaceAll(
              /[ \n\t]+/gi,
              " "
            );
            mapping.join.push(leftOuterJoin);
          }
        } else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
          const ons = referenceField.primaryKeys;

          const {
            select,
            json,
            join,
            where: w,
            values,

            alias: newAlias,
          } = mappingsReducer(
            recursiveMap(
              referenceField,
              fields[gqlFieldName],
              aliasNumber + 1,
              refAlias,
              [],
              `${refAlias}_${i}`
            )
          );
          mapping.alias = newAlias;
          aliasNumber = newAlias;

          const where = primaryKeys.map((o, i) => {
            return `${alias}.${o} = ${fieldProps.joinColumns[i]}`;
          });

          mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);

          const selectFields = [
            ...new Set(
              ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select))
            ),
          ];
          const leftOuterJoin = `left outer join lateral (
                            select coalesce(json_agg(jsonb_build_object(${json.join(
                              ", "
                            )})), '[]'::json) as value from (
                                select ${selectFields.join(", ")} 
                                    from ${referenceField.tableName} 
                                where (${referenceField.primaryKeys.join(
                                  ", "
                                )}) in (
                                    select ${fieldProps.inverseJoinColumns.join(
                                      ", "
                                    )} 
                                        from ${fieldProps.pivotTable}
                                    where ${where}
                                )
                        ) as ${refAlias}
                        ${join.join(" \n")}
                        ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, " ");

          mapping.join.push(leftOuterJoin);
        } else {
          logger.fatal(
            "reference type",
            fieldProps.reference,
            "not handled for field",
            gqlFieldName,
            "with referenceField"
          );
        }
      } else if (uniqueFieldNames.length > 0) {
        uniqueFieldNames.forEach((f) => mapping.select.add(f));
        mapping.json.push(`'${gqlFieldName}', ${uniqueFieldNames.join(", ")}`);
      } else {
        logger.fatal(
          "reference type",
          fieldProps.reference,
          "not handled for field",
          gqlFieldName
        );
      }
      return mappings;
    },
    new Map<string, MappingsType>()
  );

  res = gqlFilters.reduce((mappings, gqlFilter, _filterIndex) => {
    const filterIndex = _filterIndex * 1_000_000;
    logger.fatal("recursiveMap - gqlFilter PARENT", gqlFilter);
    Object.keys(gqlFilter).forEach((gqlFieldNameKey, fieldIndex) => {
      const fieldPrefix = `${prefix ?? ""}_${filterIndex}_${fieldIndex}`;
      logger.fatal(
        "recursiveMap - gqlFilter",
        gqlFilter,
        gqlFieldNameKey,
        fieldPrefix
      );
      logger.fatal("");
      logger.fatal("");
      logger.fatal("");

      // id_in, id_eq, id_ne, id_gt, id_gte, id_lt, id_lte, etc...
      const fieldOperation = Object.keys(FieldOperations).find((k) =>
        gqlFieldNameKey.endsWith(k)
      );
      if (fieldOperation) {
        if (!mappings.has(gqlFieldNameKey)) {
          mappings.set(gqlFieldNameKey, newMappings());
        }
        const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();

        const fieldNameBeforeOperation = gqlFieldNameKey.slice(
          0,
          -fieldOperation.length
        );
        const fieldValue = gqlFilter[
          gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
        ] as any;

        const sqlParam = `op${fieldPrefix}_${fieldIndex}`;
        if (
          fieldValue instanceof Array &&
          fieldNameBeforeOperation in properties
        ) {
          mapping.where.push(
            FieldOperations[fieldOperation as keyof typeof FieldOperations]([
              properties[fieldNameBeforeOperation as keyof typeof properties]
                .fieldNames[0],
              ...fieldValue.map((_, i) => `:${sqlParam}_${i}`),
            ])
          );
          mapping.values = {
            ...mapping.values,
            ...fieldValue.reduce((acc, v, i) => {
              acc[`${sqlParam}_${i}`] = v;
              return acc;
            }, {} as Record<string, any>),
          };
        } else {
          mapping.where.push(
            FieldOperations[fieldOperation as keyof typeof FieldOperations]([
              properties[fieldNameBeforeOperation as keyof typeof properties]
                .fieldNames[0],
              `:${sqlParam}`,
            ])
          );
          mapping.values = {
            ...mapping.values,
            [sqlParam]: fieldValue,
          };
        }
        return;
      }

      const filterValue = gqlFilter[
        gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
      ] as GQLEntityFilterInputFieldType<T>;

      if (gqlFieldNameKey in ClassOperations || fieldOperation) {
        const whereOperationFilterValue = gqlFilter[
          gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
        ] as GQLEntityFilterInputFieldType<T>[];
        const {
          join,
          where: w,
          values,
        } = mappingsReducer(
          recursiveMap<T>(
            entityMetadata,
            [],
            aliasNumber + 1,
            alias,
            whereOperationFilterValue,
            fieldPrefix,
            customFields
          )
        );
        if (!mappings.has(gqlFieldNameKey)) {
          mappings.set(gqlFieldNameKey, newMappings());
        }
        const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();

        mapping.filterJoin.push(...join);
        mapping.where.push(
          `( ${ClassOperations[gqlFieldNameKey as keyof typeof ClassOperations](
            w
          )} )`
        );
        mapping.values = { ...mapping.values, ...values };
        return;
      }

      const lowercasedFirstFieldNameKey =
        gqlFieldNameKey[0].toLowerCase() + gqlFieldNameKey.slice(1);

      // we look for the props of the field as is, if not found we look for the lowercased first letter
      const customFieldProps =
        customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>] ??
        customFields?.[
          lowercasedFirstFieldNameKey as keyof CustomFieldsSettings<T>
        ];

      // find the first compatible field name
      const fieldProps =
        properties[gqlFieldNameKey as keyof EntityMetadata<T>["properties"]] ??
        properties[
          lowercasedFirstFieldNameKey as keyof EntityMetadata<T>["properties"]
        ] ??
        properties[
          customFieldProps?.requires as keyof EntityMetadata<T>["properties"]
        ];

      // fieldNameToUse: id => id, Id => id, CustomField => CustomField (?) last one is not tested
      const fieldNameKey = fieldProps
        ? properties[gqlFieldNameKey as keyof EntityMetadata<T>["properties"]]
          ? gqlFieldNameKey
          : properties[
              lowercasedFirstFieldNameKey as keyof EntityMetadata<T>["properties"]
            ]
          ? lowercasedFirstFieldNameKey
          : null
        : null;

      const gqlFieldName =
        (customFieldProps?.requires as string) ?? fieldNameKey;

      logger.fatal("this ==>", gqlFieldNameKey, "fieldNameKey", fieldNameKey);

      if (!fieldNameKey) {
        logger.fatal(
          alias,
          gqlFieldName,
          "not found in properties nor in customFields"
        );
        throw new Error(
          `${alias} ${gqlFieldName} not found in properties nor in customFields`
        );
        return;
      }

      if (!mappings.has(fieldNameKey)) {
        mappings.set(fieldNameKey, newMappings());
      }
      const mapping = mappings.get(fieldNameKey) ?? newMappings();
      const referenceField =
        Database.em.getMetadata().has(fieldProps.type) &&
        Database.em.getMetadata().get(fieldProps.type);

      if (referenceField) {
        const refAlias = `${fieldPrefix ?? ""}_${alias}_${fieldPrefix}`;
        logger.fatal(
          "referenceField",
          referenceField.name,
          fieldProps.reference
        );

        if (
          fieldProps.reference === ReferenceType.ONE_TO_MANY ||
          fieldProps.reference === ReferenceType.ONE_TO_ONE
        ) {
          const referenceFieldProps =
            referenceField.properties[fieldProps.mappedBy];
          // logger.fatal('referenceFieldProps', referenceField.name, referenceFieldProps.mappedBy);

          const ons = referenceFieldProps.joinColumns;
          const entityOns = referenceFieldProps.referencedColumnNames;

          if (ons.length !== entityOns.length) {
            throw new Error(
              `joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}`
            );
          }

          const onSQL = entityOns
            .map((o, i) => {
              return `${alias}.${o} = ${refAlias}.${ons[i]}`;
            })
            .join(", ");

          const {
            join,
            where,
            values,
            alias: newAlias,
          } = mappingsReducer(
            recursiveMap(
              referenceField as EntityMetadata<unknown>,
              {},
              aliasNumber + 1,
              refAlias,
              [filterValue],
              `${refAlias}_${fieldPrefix}` // FIXME: this can probably be just fieldPrefix
            )
          );
          mapping.alias = newAlias;
          aliasNumber = newAlias;

          logger.fatal(
            "======>referenceField",
            gqlFieldName,
            join,
            where,
            values,
            filterValue
          );

          if (
            referenceField.tableName &&
            onSQL.length > 0 &&
            (where.length > 0 || join.length > 0)
          ) {
            // apply a filter join only if either we filter for or we have a join
            const innerJoin = `inner join lateral (
                                select ${refAlias}.* 
                                    from ${
                                      referenceField.tableName
                                    } as ${refAlias}
                                    ${join.join(" \n")}
                                where ${onSQL} 
                                ${where.length > 0 ? " and " : ""}
                                ${where.join(" and ")}
		                    ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, " ");

            mapping.filterJoin.push(innerJoin);
            mapping.values = { ...mapping.values, ...values };
          }
        } else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
          if (fieldProps.fieldNames.length && referenceField.tableName) {
            const ons = referenceField.primaryKeys;
            const entityOns = fieldProps.fieldNames;

            const onSQL = entityOns
              .map((o, i) => {
                return `${alias}.${o} = ${refAlias}.${ons[i]}`;
              })
              .join(", ");

            const {
              join,
              where,
              values,
              alias: newAlias,
            } = mappingsReducer(
              recursiveMap(
                referenceField as EntityMetadata<unknown>,
                {},
                aliasNumber + 1,
                refAlias,
                [filterValue],
                `${refAlias}_${fieldPrefix}`
              )
            );
            mapping.alias = newAlias;
            aliasNumber = newAlias;

            if (onSQL.length > 0 && (where.length > 0 || join.length > 0)) {
              const innerJoin = `inner join lateral (
                                select ${refAlias}.* from ${
                referenceField.tableName
              } as ${refAlias}
                                    ${join.join(" \n")}
                                where ${onSQL} and ${where.join(" and ")}
		                    ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, " ");
              mapping.join.push(innerJoin);
              mapping.values = { ...mapping.values, ...values };
            }
          }
        } else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
          const ons = referenceField.primaryKeys;

          const {
            where,
            join,
            values,
            alias: newAlias,
          } = mappingsReducer(
            recursiveMap(
              referenceField as EntityMetadata<unknown>,
              {},
              aliasNumber + 1,
              refAlias,
              [filterValue],
              `${refAlias}_${fieldPrefix}`
            )
          );
          mapping.alias = newAlias;
          aliasNumber = newAlias;

          const onSQL = primaryKeys.map((o, i) => {
            return `${alias}.${o} = ${fieldProps.joinColumns[i]}`;
          });
          if (onSQL.length > 0 && (where.length > 0 || join.length > 0)) {
            const innerJoin = `left outer join lateral (
		                        select ${refAlias}.*
		                            from ${referenceField.tableName}
                                    where (${referenceField.primaryKeys.join(
                                      ", "
                                    )}) in (
                                        select ${fieldProps.inverseJoinColumns.join(
                                          ", "
                                        )}
		                                from ${fieldProps.pivotTable}
                                        ${join.join(" \n")}
		                            where ${onSQL} and ${where.join(" and ")}
		                        )
		                ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, " ");

            mapping.filterJoin.push(innerJoin);
            mapping.values = { ...mapping.values, ...values };
          }
        } else {
          logger.fatal(
            "reference type",
            fieldProps.reference,
            "not handled for field",
            gqlFieldName,
            "with referenceField"
          );
        }
      } else {
        logger.fatal(gqlFieldName, "filterValue", filterValue);
        // filters example: [{ id: 1 }] => { id: 1 }
        const parsed = parseEqFilter(
          filterValue,
          fieldProps.fieldNames && fieldProps.fieldNames.length > 0
            ? fieldProps.fieldNames[0]
            : gqlFieldName,
          alias,
          fieldPrefix
        );
        if (!parsed) {
          return;
        }
        const { fieldName: eqField, eqFilter, eqValue } = parsed;
        logger.fatal(gqlFieldName, "eqField", eqField);
        logger.fatal(gqlFieldName, "eqFilter", eqFilter);
        logger.fatal(gqlFieldName, "eqValue", eqValue);

        mapping.where.push(
          fieldOperation
            ? FieldOperations[fieldOperation as keyof typeof FieldOperations]([
                eqFilter,
              ])
            : eqFilter
        );
        mapping.values = { ...mapping.values, ...eqValue };
      }
    });
    return mappings;
  }, res);
  // (orderBy ?? []).map((ob) => {
  // 	Object.keys(ob).forEach((f) => {
  // 		const m = newMappings();
  // 		const orderBy = `${alias}.${f} ${ob[f as keyof GQLEntityOrderByInputType<T>]}`;
  // 		logger.fatal('recursiveMap -> orderBy', orderBy);
  // 		[...res.entries()].forEach(([k, m]) => {
  // 			if (!m.orderBy) {
  // 				m.orderBy = [];
  // 			}
  // 			logger.fatal('recursiveMap -> orderBy added to', k);
  // 			m.orderBy.push(orderBy);
  // 		});
  // 		res.set(f, m);
  // 	});
  // });
  return res;
};
