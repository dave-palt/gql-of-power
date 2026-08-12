/**
 * Browser bundle entry point for the gql-of-power live SQL demo.
 *
 * This runs entirely in the browser — no server, no database. It:
 * 1. Registers the Middle-earth entity schema (same as the playground).
 * 2. Provides a `generateSQL(graphQLQueryString)` function that parses a
 *    raw GraphQL query, converts it to the FieldSelection format the mapper
 *    expects, and returns the generated SQL + bindings.
 *
 * Bundled with `bun build --target=browser` into a single JS file loaded by
 * demo/index.html.
 */
import 'reflect-metadata';
import { parse, visit, Kind } from 'graphql';
import {
	createGQLTypes,
	GQLtoSQLMapper,
	type EntityMetadata,
	type MetadataProvider,
} from '../../../src/index';
import { registerEnumType } from 'type-graphql';

// ─── Entity classes + metadata (standalone, no server deps) ──────────────────
// These are plain copies of the playground's entity definitions, avoiding the
// import chain that pulls in `bun`/`pg`/`knex` (server-only modules).
import {
	Person,
	Ring,
	Fellowship,
	Quest,
	Location,
	Region,
	Battle,
	Army,
	Book,
	Author,
	Genre,
	RingStatus,
	AllEntityMetadata,
} from './schema';

// Field settings: plain objects, no type-graphql `type` thunks needed for SQL
// generation. The mapper only reads `generateFilter`, `mapNumericEnum`,
// `parseJson`, `countFieldName`, `array`, `relatedEntityName`, `alias`,
// `excludeFromInput`, and `getFilterType` from these objects.
// Typed as `any` to avoid the `type` thunk requirement (which is only needed
// for type-graphql schema building, not SQL generation).

const PersonFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	age: { generateFilter: true },
	race: { generateFilter: true },
	home: { generateFilter: true },
	ring: { generateFilter: true, relatedEntityName: () => Ring.name },
	fellowship: { generateFilter: true, relatedEntityName: () => Fellowship.name },
	battles: {
		generateFilter: true,
		array: true,
		relatedEntityName: () => Battle.name,
		countFieldName: 'battleCount',
	},
	books: { generateFilter: true, array: true, relatedEntityName: () => Book.name },
};

const RingFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	power: { generateFilter: true },
	forgedBy: { generateFilter: true },
	forgedDate: { generateFilter: true, excludeFromInput: true },
	status: { generateFilter: true, mapNumericEnum: true },
	metadata: { parseJson: true },
	bearer: { generateFilter: true, relatedEntityName: () => Person.name },
};

const FellowshipFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	purpose: { generateFilter: true },
	disbanded: { generateFilter: true },
	members: {
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
		countFieldName: 'memberCount',
	},
	quest: { generateFilter: true, relatedEntityName: () => Quest.name },
};

const QuestFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	description: { generateFilter: true },
	success: { generateFilter: true },
	fellowships: { generateFilter: true, array: true, relatedEntityName: () => Fellowship.name },
	locations: { generateFilter: true, array: true, relatedEntityName: () => Location.name },
};

const LocationFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	type: { generateFilter: true },
	description: { generateFilter: true },
	region: { generateFilter: true, relatedEntityName: () => Region.name },
	quests: { generateFilter: true, array: true, relatedEntityName: () => Quest.name },
	battles: { generateFilter: true, array: true, relatedEntityName: () => Battle.name },
};

const RegionFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	ruler: { generateFilter: true },
	locations: {
		generateFilter: true,
		array: true,
		relatedEntityName: () => Location.name,
		countFieldName: 'locationCount',
	},
};

const BattleFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	outcome: { generateFilter: true },
	casualties: { generateFilter: true },
	location: { generateFilter: true, relatedEntityName: () => Location.name },
	warriors: { generateFilter: true, array: true, relatedEntityName: () => Person.name },
	armies: { generateFilter: true, array: true, relatedEntityName: () => Army.name },
};

const ArmyFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	size: { generateFilter: true },
	allegiance: { generateFilter: true },
	leader: { generateFilter: true },
	battles: { generateFilter: true, array: true, relatedEntityName: () => Battle.name },
};

const AuthorFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	birthYear: { generateFilter: true },
	nationality: { generateFilter: true },
	books: {
		generateFilter: true,
		array: true,
		relatedEntityName: () => Book.name,
		countFieldName: 'bookCount',
	},
};

const BookFields: Record<string, any> = {
	id: { generateFilter: true },
	title: { generateFilter: true },
	publishedYear: { generateFilter: true },
	pages: { generateFilter: true },
	author: { generateFilter: true, relatedEntityName: () => Author.name },
	characters: { generateFilter: true, array: true, relatedEntityName: () => Person.name },
	genres: { generateFilter: true, array: true, relatedEntityName: () => Genre.name },
};

const GenreFields: Record<string, any> = {
	id: { generateFilter: true },
	name: { generateFilter: true },
	description: { generateFilter: true },
	books: { generateFilter: true, array: true, relatedEntityName: () => Book.name },
};

// ─── Schema registration ─────────────────────────────────────────────────────
// Must happen before any query generation. Order matters for cross-entity
// type references (same as the playground).
registerEnumType(RingStatus, { name: 'RingStatus' });

// Custom field definitions — kept as plain objects because the mapper needs
// them at query time, separate from the GQL type registration.
const personCustomFields: Record<string, any> = {
	homeRegion: {
		type: () => RegionGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		mapping: {
			refEntity: Region,
			refFields: 'id',
			fields: 'homeRegionId',
		},
	},
};

// Entities that reference others via XxxGQL.GQLEntity thunks must be declared
// after their dependencies. Region has no deps, Person references Region via
// custom field, etc. — mirror the playground order.
const RegionGQL = createGQLTypes(Region, RegionFields);
createGQLTypes(Person, PersonFields, { customFields: personCustomFields });
createGQLTypes(Ring, RingFields);
createGQLTypes(Fellowship, FellowshipFields);
createGQLTypes(Quest, QuestFields);
createGQLTypes(Location, LocationFields);
createGQLTypes(Battle, BattleFields);
createGQLTypes(Army, ArmyFields);
createGQLTypes(Author, AuthorFields);
createGQLTypes(Book, BookFields);
createGQLTypes(Genre, GenreFields);

// ─── Map of root query field name → entity class ─────────────────────────────
// The GraphQL query root field (e.g. `persons`, `rings`) maps to the entity
// whose metadata drives SQL generation. The mapper receives the ORM class
// constructor whose `.name` matches the metadata key.
const ROOT_FIELDS: Record<string, { entity: new () => any; customFields?: any }> = {
	persons: { entity: Person, customFields: personCustomFields },
	rings: { entity: Ring },
	fellowships: { entity: Fellowship },
	quests: { entity: Quest },
	locations: { entity: Location },
	regions: { entity: Region },
	battles: { entity: Battle },
	armies: { entity: Army },
	authors: { entity: Author },
	books: { entity: Book },
	genres: { entity: Genre },
};

// ─── Mock metadata provider (no DB needed) ───────────────────────────────────
const provider: MetadataProvider = {
	client: 'pg',
	exists: (name: string) => name in AllEntityMetadata,
	getMetadata: <T, K extends EntityMetadata<T>>(name: string) =>
		AllEntityMetadata[name as keyof typeof AllEntityMetadata] as K,
	executeQuery: async () => [],
};

const mapper = new GQLtoSQLMapper(provider);

// ─── GraphQL AST → FieldSelection converter ──────────────────────────────────
// Recursively converts a GraphQL selection set into the FieldSelection format
// that graphql-parse-resolve-info produces and the mapper expects. Each
// relation field gets a `fieldsByTypeName` keyed by the related entity's
// metadata name so the mapper can resolve sub-fields correctly.
function selectionSetToFields(selectionSet: any, parentEntityName: string): Record<string, any> {
	const result: Record<string, any> = {};
	if (!selectionSet?.selections) return result;

	const parentMeta = AllEntityMetadata[parentEntityName as keyof typeof AllEntityMetadata];
	if (!parentMeta) return result;

	for (const selection of selectionSet.selections) {
		if (selection.kind === Kind.FIELD) {
			const fieldName = selection.name.value;

			// Skip count fields and custom fields — they're not in entity metadata
			// properties but the mapper handles them via registries.
			const fieldProps = parentMeta.properties[fieldName];

			if (selection.selectionSet) {
				// This is a relation field — resolve the child entity name
				let childEntityName = fieldName;
				if (fieldProps?.type) {
					childEntityName = fieldProps.type;
				}
				const subFields = selectionSetToFields(selection.selectionSet, childEntityName);
				result[fieldName] = {
					name: fieldName,
					alias: selection.alias?.value ?? fieldName,
					fieldsByTypeName: {
						[childEntityName]: subFields,
					},
				};
			} else {
				// Scalar field
				result[fieldName] = {
					name: fieldName,
					alias: selection.alias?.value ?? fieldName,
				};
			}

			// Handle inline arguments (filter, pagination)
			if (selection.arguments?.length > 0) {
				const args: Record<string, any> = {};
				for (const arg of selection.arguments) {
					args[arg.name.value] = valueFromAST(arg.value);
				}
				result[fieldName].args = args;
			}
		} else if (selection.kind === Kind.INLINE_FRAGMENT) {
			// Merge inline fragment fields
			const sub = selectionSetToFields(selection.selectionSet, parentEntityName);
			Object.assign(result, sub);
		}
	}
	return result;
}

function valueFromAST(astValue: any): any {
	switch (astValue.kind) {
		case Kind.INT:
			return parseInt(astValue.value, 10);
		case Kind.FLOAT:
			return parseFloat(astValue.value);
		case Kind.STRING:
		case Kind.ENUM:
			return astValue.value;
		case Kind.BOOLEAN:
			return astValue.value;
		case Kind.LIST:
			return astValue.values.map(valueFromAST);
		case Kind.OBJECT: {
			const obj: Record<string, any> = {};
			for (const field of astValue.fields) {
				obj[field.name.value] = valueFromAST(field.value);
			}
			return obj;
		}
		case Kind.NULL:
			return null;
		default:
			return undefined;
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────
export function generateSQL(query: string): { sql: string; bindings: any; error?: string } {
	try {
		const ast = parse(query);
		let rootField: any = null;

		visit(ast, {
			OperationDefinition(node: any) {
				if (node.selectionSet?.selections?.length > 0) {
					// Find the first top-level field that matches a known root
					rootField = node.selectionSet.selections.find(
						(s: any) => s.kind === Kind.FIELD && s.name.value in ROOT_FIELDS
					);
				}
			},
		});

		if (!rootField) {
			return {
				sql: '',
				bindings: {},
				error: 'No recognized root field found. Use one of: ' + Object.keys(ROOT_FIELDS).join(', '),
			};
		}

		const rootName = rootField.name.value;
		const { entity, customFields } = ROOT_FIELDS[rootName];
		const entityName = entity.name;

		const fields = selectionSetToFields(rootField.selectionSet, entityName);

		// Extract filter/pagination from root arguments
		const filter: any = {};
		const pagination: any = {};
		let hasFilter = false;
		let hasPagination = false;

		if (rootField.arguments) {
			for (const arg of rootField.arguments) {
				const val = valueFromAST(arg.value);
				if (arg.name.value === 'filter') {
					Object.assign(filter, val);
					hasFilter = true;
				} else if (arg.name.value === 'pagination') {
					Object.assign(pagination, val);
					hasPagination = true;
				}
			}
		}

		const result = mapper.buildQueryAndBindingsFor({
			fields,
			entity,
			customFields: customFields ?? {},
			...(hasFilter ? { filter } : {}),
			...(hasPagination ? { pagination } : {}),
		});

		return { sql: result.querySQL, bindings: result.bindings };
	} catch (e: any) {
		return { sql: '', bindings: {}, error: e.message || String(e) };
	}
}

// ─── Schema hints for autocomplete ───────────────────────────────────────────
// Exposes the entity → fields map so the editor can offer context-aware
// autocomplete. Returns root fields + each entity's scalar and relation fields.
function getSchemaHints() {
	const rootFields = Object.keys(ROOT_FIELDS);
	const entityFields: Record<string, { scalars: string[]; relations: string[] }> = {};
	const fieldsMap: Record<string, Record<string, any>> = {
		persons: PersonFields,
		rings: RingFields,
		fellowships: FellowshipFields,
		quests: QuestFields,
		locations: LocationFields,
		regions: RegionFields,
		battles: BattleFields,
		armies: ArmyFields,
		authors: AuthorFields,
		books: BookFields,
		genres: GenreFields,
	};

	for (const [rootName, { entity }] of Object.entries(ROOT_FIELDS)) {
		const meta = AllEntityMetadata[entity.name as keyof typeof AllEntityMetadata];
		const scalars: string[] = [];
		const relations: string[] = [];
		for (const [name, prop] of Object.entries(meta.properties)) {
			if (prop.reference) relations.push(name);
			else if (name !== 'homeRegionId') scalars.push(name);
		}
		// Add count fields from the fields config
		const fcfg = fieldsMap[rootName];
		if (fcfg) {
			for (const fopts of Object.values(fcfg)) {
				if ((fopts as any)?.countFieldName) scalars.push((fopts as any).countFieldName);
			}
		}
		entityFields[entity.name] = { scalars, relations };
	}

	return { rootFields, entityFields };
}

// Expose globally for the demo page
declare global {
	interface Window {
		gqlOfPower: { generateSQL: typeof generateSQL; getSchemaHints: typeof getSchemaHints };
	}
}
window.gqlOfPower = { generateSQL, getSchemaHints };
