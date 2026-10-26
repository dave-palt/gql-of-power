/**
 * String-form orderBy normalization + SDL scalar (issue #68).
 *
 * The runtime has always accepted nested-object orderBy entries
 * (`{ author: { name: 'asc' } }`) through the programmatic API, but the
 * generated SDL input types could not express them, so GraphQL clients had
 * no way to order by a related entity's column.
 *
 * This module closes the gap with a string grammar, valid as a plain GraphQL
 * String input:
 *
 *   "title"                 → { title: 'asc' }            (default asc)
 *   "title desc"            → { title: 'desc' }
 *   "author.name"           → { author: { name: 'asc' } } (one relation hop)
 *   "author.name desc"      → { author: { name: 'desc' } }
 *
 * Strings are normalized into the exact nested-object shape the SQL mapper
 * already consumes, so no mapper logic changes. The existing object form is
 * still accepted (backward compatible) — the SDL `orderBy` argument is now a
 * list of the `GQLOrderBySpec` scalar, which validates BOTH forms at the
 * GraphQL boundary.
 */
import { GraphQLError, GraphQLScalarType, Kind, ObjectValueNode, ValueNode } from 'graphql';

export type OrderByObjectForm = Record<string, unknown>;
export type OrderByElement = OrderByObjectForm | string;

const ORDER_BY_STRING_RE =
	/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(?:\s+(asc|desc))?$/i;

/**
 * Parses a single orderBy string into the nested-object form.
 * @throws Error with a user-actionable message on invalid input.
 */
export function parseOrderByString(raw: string): OrderByObjectForm {
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new Error(
			'gql-of-power: orderBy entries must be non-empty strings or objects — got ' +
				JSON.stringify(raw)
		);
	}
	const match = raw.trim().match(ORDER_BY_STRING_RE);
	if (!match) {
		// Distinguish the "too many hops" case for a clearer message.
		const segments = raw.trim().split(/\s+/)[0].split('.');
		if (segments.length > 2) {
			throw new Error(
				`gql-of-power: orderBy string "${raw}" uses ${segments.length} path segments — ` +
					'at most one relation hop is supported (e.g. "author.name"), not "a.b.c"'
			);
		}
		throw new Error(
			`gql-of-power: invalid orderBy string "${raw}" — expected "field", "field asc|desc", ` +
				'"relation.field" or "relation.field asc|desc"'
		);
	}
	const [, path, rawDir] = match;
	const direction = (rawDir ?? 'asc').toLowerCase();
	const segments = path.split('.');
	if (segments.length === 1) {
		return { [segments[0]]: direction };
	}
	return { [segments[0]]: { [segments[1]]: direction } };
}

/**
 * Normalizes an orderBy array: string entries become nested objects,
 * object entries pass through untouched (programmatic API compatibility).
 * @throws Error on unsupported element types or invalid strings.
 */
export function normalizeOrderBy(orderBy?: OrderByElement[]): OrderByObjectForm[] | undefined {
	if (orderBy === undefined || orderBy === null) return undefined;
	return orderBy.map((el) => {
		if (typeof el === 'string') return parseOrderByString(el);
		if (el !== null && typeof el === 'object' && !Array.isArray(el)) return el;
		throw new Error(
			`gql-of-power: orderBy entries must be strings or objects — got ${typeof el} ` +
				JSON.stringify(el)
		);
	});
}

/** Extracts an object literal from a GraphQL AST for the object orderBy form. */
function literalToObject(ast: ObjectValueNode): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of ast.fields) {
		const v: ValueNode = field.value;
		if (v.kind === Kind.STRING || v.kind === Kind.ENUM) {
			out[field.name.value] = v.value;
		} else if (v.kind === Kind.OBJECT) {
			out[field.name.value] = literalToObject(v);
		} else {
			throw new GraphQLError(
				`GQLOrderBySpec: unsupported value for "${field.name.value}" — use a direction ` +
					"('asc'/'desc'/ASC/DESC), a string, or a nested relation field",
				{ nodes: [v] }
			);
		}
	}
	return out;
}

/**
 * Scalar accepting both orderBy forms as SDL input:
 *   strings — "title", "author.name desc" (validated eagerly at parse time)
 *   objects — { title: ASC }, { author: { name: 'desc' } }
 * Shared by every entity's PaginationInput orderBy argument.
 */
export const GQLOrderBySpecScalar = new GraphQLScalarType({
	name: 'GQLOrderBySpec',
	description:
		'Ordering specification: either a string ("field", "field asc|desc", ' +
		'"relation.field", "relation.field asc|desc") or an object ' +
		'({ field: ASC } / { relation: { field: DESC } })',
	serialize(value) {
		return value;
	},
	parseValue(value) {
		if (typeof value === 'string') {
			parseOrderByString(value); // validate eagerly, throw on bad grammar
			return value;
		}
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
		throw new GraphQLError(
			`GQLOrderBySpec cannot represent ${typeof value} — use a string or an object`
		);
	},
	parseLiteral(ast) {
		if (ast.kind === Kind.STRING) {
			parseOrderByString(ast.value); // validate eagerly, throw on bad grammar
			return ast.value;
		}
		if (ast.kind === Kind.OBJECT) return literalToObject(ast);
		throw new GraphQLError(
			`GQLOrderBySpec cannot represent ${ast.kind} — use a string or an object literal`,
			{ nodes: [ast] }
		);
	},
});
