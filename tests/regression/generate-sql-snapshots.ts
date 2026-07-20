/**
 * SQL regression scenario generator.
 *
 * Builds queries for a comprehensive matrix of features using the same fixtures
 * that ship with the library, and prints one JSON line per scenario:
 *   {"name": "...", "sql": "..."}
 *
 * The SQL is whitespace-normalized (single spaces) so before/after diffs are
 * stable regardless of template-literal indentation changes.
 *
 * Run from either the baseline worktree or HEAD to capture golden SQL:
 *   bun tests/regression/generate-sql-snapshots.ts
 */
import 'reflect-metadata';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { createMockMetadataProvider } from '../fixtures/test-data';
import { Author, Battle, Book, Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import '../setup';

const provider = createMockMetadataProvider();
const mapper = new GQLtoSQLMapper(provider);

type Scenario = {
	name: string;
	fields: Record<string, any>;
	entity: new () => any;
	customFields?: Record<string, any>;
	filter?: any;
	pagination?: any;
};

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const scenarios: Scenario[] = [
	// ── Basic scalar queries ──────────────────────────────────────────────
	{
		name: 'basic-person-scalar',
		fields: { id: {}, name: {}, age: {}, race: {} },
		entity: Person,
	},
	{
		name: 'basic-ring-scalar',
		fields: { id: {}, name: {}, power: {}, forgedBy: {} },
		entity: Ring,
	},

	// ── Relationship nesting (all 4 types) ────────────────────────────────
	{
		name: 'rel-1to1-person-to-ring',
		fields: { id: {}, name: {}, ring: { id: {}, name: {}, power: {} } },
		entity: Person,
	},
	{
		name: 'rel-1to1-ring-to-bearer',
		fields: { id: {}, name: {}, bearer: { id: {}, name: {} } },
		entity: Ring,
	},
	{
		name: 'rel-1m-fellowship-to-members',
		fields: { id: {}, name: {}, members: { id: {}, name: {}, race: {} } },
		entity: Fellowship,
	},
	{
		name: 'rel-m1-person-to-fellowship',
		fields: { id: {}, name: {}, fellowship: { id: {}, name: {} } },
		entity: Person,
	},
	{
		name: 'rel-mm-person-to-battles',
		fields: { id: {}, name: {}, battles: { id: {}, name: {}, outcome: {} } },
		entity: Person,
	},

	// ── Deep nesting (multi-level) ────────────────────────────────────────
	{
		name: 'deep-person-ring-bearer',
		fields: {
			id: {},
			name: {},
			ring: { id: {}, name: {}, bearer: { id: {}, name: {} } },
		},
		entity: Person,
	},
	{
		name: 'deep-fellowship-members-battles',
		fields: {
			id: {},
			name: {},
			members: {
				id: {},
				name: {},
				battles: { id: {}, name: {} },
			},
		},
		entity: Fellowship,
	},

	// ── Filter operators ──────────────────────────────────────────────────
	{
		name: 'filter-eq',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { name: 'Frodo' },
	},
	{
		name: 'filter-in',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { id_in: [1, 2, 3] },
	},
	{
		name: 'filter-nin',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { id_nin: [1, 2] },
	},
	{
		name: 'filter-like',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { name_like: '%Baggins%' },
	},
	{
		name: 'filter-ne',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { race_ne: 'Orc' },
	},
	{
		name: 'filter-gt-lt',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { age_gt: 50, age_lt: 200 },
	},

	// ── Compound filters (_and / _or) ─────────────────────────────────────
	{
		name: 'filter-and',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: {
			_and: [{ name_like: 'F%' }, { age_gt: 30 }],
		},
	},
	{
		name: 'filter-or',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: {
			_or: [{ race: 'Hobbit' }, { race: 'Elf' }],
		},
	},
	{
		name: 'filter-and-or-nested',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: {
			_and: [{ age_gt: 20 }, { _or: [{ race: 'Hobbit' }, { race: 'Man' }] }],
		},
	},

	// ── Relationship filters ──────────────────────────────────────────────
	{
		name: 'filter-rel-fellowship-name',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { fellowship: { name: 'Fellowship of the Ring' } } as any,
	},
	{
		name: 'filter-rel-ring-name',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { ring: { name: 'The One Ring' } } as any,
	},

	// ── Exists filters ────────────────────────────────────────────────────
	{
		name: 'filter-exists-ring',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { _exists: { Ring: {} } } as any,
	},
	{
		name: 'filter-not-exists-battle',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { _not_exists: { Battle: {} } } as any,
	},

	// ── Count fields ──────────────────────────────────────────────────────
	{
		name: 'count-author-bookcount',
		fields: { id: {}, name: {}, bookCount: {} },
		entity: Author,
	},
	{
		name: 'count-author-bookcount-filter',
		fields: { id: {}, name: {} },
		entity: Author,
		filter: { bookCount_gt: 3 } as any,
	},

	// ── Pagination ────────────────────────────────────────────────────────
	{
		name: 'pagination-limit-offset',
		fields: { id: {}, name: {} },
		entity: Person,
		pagination: { limit: 10, offset: 5 },
	},
	{
		name: 'pagination-orderby',
		fields: { id: {}, name: {} },
		entity: Person,
		pagination: { limit: 5, orderBy: [{ name: 'asc' }] },
	},

	// ── Book + Genre (m:m) ────────────────────────────────────────────────
	{
		name: 'rel-mm-book-to-genres',
		fields: { id: {}, title: {}, genres: { id: {}, name: {} } },
		entity: Book,
	},
	{
		name: 'rel-m1-book-to-author',
		fields: { id: {}, title: {}, author: { id: {}, name: {} } },
		entity: Book,
	},
];

// ── Run and emit ─────────────────────────────────────────────────────────
for (const s of scenarios) {
	try {
		const result = mapper.buildQueryAndBindingsFor({
			fields: s.fields,
			entity: s.entity,
			customFields: s.customFields ?? {},
			filter: s.filter,
			pagination: s.pagination,
		});
		console.log(JSON.stringify({ name: s.name, sql: normalize(result.querySQL) }));
	} catch (e) {
		console.log(JSON.stringify({ name: s.name, error: String(e) }));
	}
}
