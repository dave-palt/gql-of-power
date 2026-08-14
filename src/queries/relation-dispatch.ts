import { EntityMetadata, EntityProperty, ReferenceType } from '../types/sql-types';
import { Alias } from './alias';
import { logger } from '../variables';

/**
 * Which JOIN strategy a relation property dispatches to.
 *
 * - `ONE_TO_X`     — FK lives on the RELATED table (child). Covers 1:m and
 *                    INVERSE-side 1:1 (`mappedBy` set) → mapOneToX / mapFilterOneToX.
 * - `MANY_TO_ONE`  — FK lives on THIS table (parent). Covers m:1 and OWNING-side
 *                    1:1 (`inversedBy` set) → mapManyToOne / mapFilterManyToOne.
 *                    This is the ownership rule fixed in PR #46 (issue #45): an
 *                    owning-side 1:1 is structurally a ManyToOne.
 * - `MANY_TO_MANY` — pivot table join → mapManyToMany / mapFilterManyToMany.
 *
 * Note: this is intentionally NOT `ReferenceType` — the raw ORM enum can't
 * express the 1:1 ownership split. `getRelationCardinality()` is the single
 * place that reads `ReferenceType` and folds ownership flags into this
 * 3-way dispatch outcome.
 */
export const RelationCardinality = {
	ONE_TO_X: 'one-to-x',
	MANY_TO_ONE: 'many-to-one',
	MANY_TO_MANY: 'many-to-many',
} as const;
export type RelationCardinality = (typeof RelationCardinality)[keyof typeof RelationCardinality];

/**
 * THE single source of truth for relation ownership dispatch.
 *
 * Every code path that branches on `fieldProps.reference` (selection mapping,
 * top-level filters, count subqueries, aggregate subqueries, orderBy on
 * related columns, …) MUST call this instead of inlining the comparison —
 * PR #46 (issue #45) happened precisely because the 1:1 ownership rule was
 * copy-pasted at six sites and drifted.
 */
export function getRelationCardinality(
	fieldProps: EntityProperty
): RelationCardinality | undefined {
	const reference = fieldProps.reference;
	if (
		reference === ReferenceType.ONE_TO_MANY ||
		(reference === ReferenceType.ONE_TO_ONE && !fieldProps.inversedBy)
	) {
		return RelationCardinality.ONE_TO_X;
	}
	if (
		reference === ReferenceType.MANY_TO_ONE ||
		(reference === ReferenceType.ONE_TO_ONE && fieldProps.inversedBy)
	) {
		return RelationCardinality.MANY_TO_ONE;
	}
	if (reference === ReferenceType.MANY_TO_MANY) {
		return RelationCardinality.MANY_TO_MANY;
	}
	return undefined;
}

/**
 * Resolves the inverse-side property on the related entity for a 1:m /
 * inverse-1:1 relation (`mappedBy`), with a clear error when the related
 * entity's metadata does not declare the inverse property back.
 *
 * Without this guard an incomplete metadata provider crashes with
 * `TypeError: Cannot read properties of undefined (reading 'joinColumns')`.
 */
export function resolveInverseProperty(
	fieldProps: EntityProperty,
	relatedMetadata: EntityMetadata<any>
): EntityProperty {
	if (!fieldProps.mappedBy) {
		throw new Error(
			`gql-of-power: relation "${fieldProps.name}" is one-to-x (1:m or inverse 1:1) but has no "mappedBy" — the FK property name on "${relatedMetadata.name ?? relatedMetadata.tableName}" is required.`
		);
	}
	const inverseProps =
		relatedMetadata.properties[fieldProps.mappedBy as keyof typeof relatedMetadata.properties];
	if (!inverseProps || !inverseProps.joinColumns) {
		throw new Error(
			`gql-of-power: inverse property "${fieldProps.mappedBy}" (mappedBy of "${fieldProps.name}") is not declared in the metadata of "${relatedMetadata.name ?? relatedMetadata.tableName}" — add the FK property so the join columns can be resolved.`
		);
	}
	return inverseProps;
}

/**
 * Builds the correlated ON-condition (`parent.<cols> = related.<cols>`)
 * between a parent row and its related rows, for all cardinalities.
 *
 * This is the logic duplicated (with drift) inside count-field subqueries
 * (`GQLtoSQLMapper.mapCountField` and `FilterProcessor.buildCountSubquerySQL`).
 * Any new correlated-subquery feature (aggregates, orderBy-on-related, …)
 * should reuse this instead of re-deriving the join.
 *
 * m:n emits `(related.pk1, …) in (select <inverseJoinColumns> from <pivot> where parent.pk = pivot.<joinColumns>)`.
 */
export function buildCorrelatedJoinCondition(params: {
	fieldProps: EntityProperty;
	relatedMetadata: EntityMetadata<any>;
	parentPrimaryKeys: string[];
	parentAlias: Alias;
	relatedAlias: Alias;
}): { sql: string; cardinality: RelationCardinality | undefined } {
	const { fieldProps, relatedMetadata, parentPrimaryKeys, parentAlias, relatedAlias } = params;
	const cardinality = getRelationCardinality(fieldProps);

	if (cardinality === RelationCardinality.ONE_TO_X) {
		const inverseProps = resolveInverseProperty(fieldProps, relatedMetadata);
		if (inverseProps.referencedColumnNames.length !== inverseProps.joinColumns.length) {
			throw new Error(
				`gql-of-power: 1:x joins with different number of columns ${inverseProps.referencedColumnNames.length} !== ${inverseProps.joinColumns.length} on ${inverseProps.name}`
			);
		}
		return {
			cardinality,
			sql: inverseProps.referencedColumnNames
				.map(
					(o, i) =>
						`${parentAlias.toColumnName(o)} = ${relatedAlias.toColumnName(inverseProps.joinColumns[i])}`
				)
				.join(' and '),
		};
	}

	if (cardinality === RelationCardinality.MANY_TO_ONE) {
		const ons =
			fieldProps.referencedColumnNames.length > 0
				? fieldProps.referencedColumnNames
				: relatedMetadata.primaryKeys;
		const entityOns = fieldProps.fieldNames;
		if (entityOns.length !== ons.length) {
			throw new Error(
				`gql-of-power: m:1 join with different number of columns ${ons.length} !== ${entityOns.length} on ${fieldProps.name}`
			);
		}
		return {
			cardinality,
			sql: entityOns
				.map((o, i) => `${parentAlias.toColumnName(o)} = ${relatedAlias.toColumnName(ons[i])}`)
				.join(' and '),
		};
	}

	if (cardinality === RelationCardinality.MANY_TO_MANY) {
		if (!fieldProps.pivotTable || fieldProps.joinColumns.length === 0) {
			throw new Error(
				`gql-of-power: m:n relation "${fieldProps.name}" is missing pivot metadata (pivotTable/joinColumns). ` +
					`These live on the OWNING side of the relation — declare them here (or query from the owning side), MikroORM-style inverse sides do not carry pivot columns.`
			);
		}
		const pivotCols = fieldProps.joinColumns;
		const inverseCols = fieldProps.inverseJoinColumns;
		const pivotSubquery = `select ${inverseCols.join(', ')} from ${fieldProps.pivotTable} where ${pivotCols
			.map(
				(c, i) =>
					`${parentAlias.toColumnName(parentPrimaryKeys[i])} = ${fieldProps.pivotTable}.${c}`
			)
			.join(' and ')}`;
		return {
			cardinality,
			sql: `(${relatedMetadata.primaryKeys
				.map((c) => relatedAlias.toColumnName(c))
				.join(', ')}) in (${pivotSubquery})`,
		};
	}

	logger.warn(
		'relation-dispatch: unsupported reference type',
		fieldProps.reference,
		'for field',
		fieldProps.name
	);
	return { sql: '', cardinality: undefined };
}
