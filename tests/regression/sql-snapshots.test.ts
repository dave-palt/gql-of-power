/**
 * SQL regression tests — golden snapshots of generated SQL.
 *
 * Asserts byte-for-byte identical SQL output for a comprehensive matrix of
 * query scenarios (all relationship types, filter operators, compound _and/_or,
 * exists filters, count fields, pagination, deep nesting).
 *
 * Snapshots captured from pre-refactor baseline (84fc4dc) and verify the
 * fallow-driven refactoring produced zero SQL behavioral changes.
 *
 * SQL generation does NOT require PostgreSQL — only execution does.
 * To regenerate: bun tests/regression/generate-sql-snapshots.ts
 */
import { describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { createMockMetadataProvider } from '../fixtures/test-data';
import { Author, Battle, Book, Fellowship, Person, Ring } from '../fixtures/middle-earth-schema';
import '../setup';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const goldenSQL: Record<string, string> = {
	'basic-person-scalar':
		'select e_a1.id, e_a1.person_name AS "name", e_a1.age, e_a1.race from ( select e_a1.id, e_a1.person_name, e_a1.age, e_a1.race from persons as e_a1 where true ) as e_a1',
	'basic-ring-scalar':
		'select e_a1.id, e_a1.ring_name AS "name", e_a1.power_description AS "power", e_a1.forged_by AS "forgedBy" from ( select e_a1.id, e_a1.ring_name, e_a1.power_description, e_a1.forged_by from rings as e_a1 where true ) as e_a1',
	'rel-1to1-person-to-ring':
		'select e_a1.id, e_a1.person_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'rel-1to1-ring-to-bearer':
		'select e_a1.id, e_a1.ring_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.ring_name from rings as e_a1 where true ) as e_a1',
	'rel-1m-fellowship-to-members':
		'select e_a1.id, e_a1.fellowship_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.fellowship_name from fellowships as e_a1 where true ) as e_a1',
	'rel-m1-person-to-fellowship':
		'select e_a1.id, e_a1.person_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'rel-mm-person-to-battles':
		'select e_a1.id, e_a1.person_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'deep-person-ring-bearer':
		'select e_a1.id, e_a1.person_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'deep-fellowship-members-battles':
		'select e_a1.id, e_a1.fellowship_name AS "name", null AS "[object Object]" from ( select e_a1.id, e_a1.fellowship_name from fellowships as e_a1 where true ) as e_a1',
	'filter-eq':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.person_name = :e_person_name1_person_name ) ) as e_a1',
	'filter-in':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.id in (:v_id_in1_1__0, :v_id_in1_1__1, :v_id_in1_1__2) ) ) as e_a1',
	'filter-nin':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.id not in (:v_id_nin1_1__0, :v_id_nin1_1__1) ) ) as e_a1',
	'filter-like':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.person_name like :v_name_like1_1 ) ) as e_a1',
	'filter-ne':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.race != :v_race_ne1_1 ) ) as e_a1',
	'filter-gt-lt':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.age > :v_age_gt1_1 and e_a1.age < :v_age_lt1_1 ) ) as e_a1',
	'filter-and':
		'select e_a1.id, e_a1.person_name AS "name" from ( select distinct * from ((select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.person_name like :v_name_like2_1 and e_a1.age > :v_age_gt2_1 ))) as e_a1_u ) as e_a1',
	'filter-or':
		'select e_a1.id, e_a1.person_name AS "name" from ( select distinct * from ((select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.race = :e_race1_race )) union all (select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.race = :e_race2_race ))) as e_a1_u ) as e_a1',
	'filter-and-or-nested':
		'select e_a1.id, e_a1.person_name AS "name" from ( select distinct * from ((select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.age > :v_age_gt3_1 and e_a1.race = :e_race3_race )) union all (select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.age > :v_age_gt3_1 and e_a1.race = :e_race4_race ))) as e_a1_u ) as e_a1',
	'filter-rel-fellowship-name':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "fellowships" as e_w1 where e_a1.fellowship_id = e_w1.id and ( e_w1.fellowship_name = :e_fellowship_name1_fellowship_name ) limit 1) ) ) as e_a1',
	'filter-rel-ring-name':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "rings" as e_w2 where e_a1.id = e_w2.bearer_id and ( e_w2.ring_name = :e_ring_name1_ring_name ) limit 1) ) ) as e_a1',
	// 1:m relationship filter — Fellowship filtered by a field on its Members (Person)
	'filter-rel-fellowship-members-race':
		'select e_a1.id, e_a1.fellowship_name AS "name" from ( select e_a1.id, e_a1.fellowship_name from fellowships as e_a1 where true and ( exists (select 1 from "persons" as e_w3 where e_a1.id = e_w3.fellowship_id and ( e_w3.race = :e_race5_race ) limit 1) ) ) as e_a1',
	// m:m relationship filter — Person filtered by a field on their Battles
	'filter-rel-person-battles-outcome':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "battles" as e_w4 where (id) in (select battle_id from person_battles where e_a1.id = person_battles.person_id) and ( e_w4.outcome = :e_outcome1_outcome ) limit 1) ) ) as e_a1',
	// Compound _and containing a relationship sub-filter
	'filter-and-with-rel':
		'select e_a1.id, e_a1.person_name AS "name" from ( select distinct * from ((select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "fellowships" as e_w5 where e_a1.fellowship_id = e_w5.id and ( e_w5.fellowship_name = :e_fellowship_name2_fellowship_name ) limit 1) and e_a1.age > :v_age_gt4_1 ))) as e_a1_u ) as e_a1',
	// Compound _or containing a relationship sub-filter
	'filter-or-with-rel':
		'select e_a1.id, e_a1.person_name AS "name" from ( select distinct * from ((select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "fellowships" as e_w6 where e_a1.fellowship_id = e_w6.id and ( e_w6.fellowship_name = :e_fellowship_name3_fellowship_name ) limit 1) )) union all (select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( exists (select 1 from "rings" as e_w7 where e_a1.id = e_w7.bearer_id and ( e_w7.ring_name = :e_ring_name2_ring_name ) limit 1) ))) as e_a1_u ) as e_a1',
	// _between filter operator — { age_between: [low, high] }
	'filter-between-age':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.age between :v_age1_0 and :v_age2_1 ) ) as e_a1',
	// _fulltext filter — Postgres tsvector @@ tsquery
	'filter-fulltext-name':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.person_name::tsvector @@ :v_name_fulltext1_1::tsquery ) ) as e_a1',
	// _overlap filter — ARRAY && ARRAY
	'filter-overlap-race':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( ARRAY[e_a1.race] && ARRAY[:v_race1_0] ) ) as e_a1',
	// _contains filter — ARRAY @> ARRAY
	'filter-contains-race':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( ARRAY[e_a1.race] @> ARRAY[:v_race_contains1_1__0] ) ) as e_a1',
	// _not class operation — negates a conjunction of conditions
	'filter-not-simple':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( not (e_a1.person_name = :e_person_name2_person_name) ) ) as e_a1',
	'filter-not-multi':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( not (e_a1.person_name = :e_person_name3_person_name and e_a1.race = :e_race6_race) ) ) as e_a1',
	'filter-not-with-other':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true and ( e_a1.age > :v_age_gt5_1 and not (e_a1.race = :e_race7_race) ) ) as e_a1',
	'filter-exists-ring':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'filter-not-exists-battle':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true ) as e_a1',
	'count-author-bookcount':
		'select e_a1.id, e_a1.author_name AS "name", null AS "bookCount" from ( select e_a1.id, e_a1.author_name from authors as e_a1 where true ) as e_a1',
	'pagination-limit-offset':
		'select e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true limit :limit offset :offset ) as e_a1',
	'pagination-orderby':
		'select e_a1.person_name, e_a1.id, e_a1.person_name AS "name" from ( select e_a1.id, e_a1.person_name from persons as e_a1 where true order by e_a1.person_name asc limit :limit ) as e_a1 order by e_a1.person_name asc',
	'rel-mm-book-to-genres':
		'select e_a1.id, e_a1.book_title AS "title", null AS "[object Object]" from ( select e_a1.id, e_a1.book_title from books as e_a1 where true ) as e_a1',
	'rel-m1-book-to-author':
		'select e_a1.id, e_a1.book_title AS "title", null AS "[object Object]" from ( select e_a1.id, e_a1.book_title from books as e_a1 where true ) as e_a1',
};

type Scenario = {
	name: string;
	fields: Record<string, any>;
	entity: new () => any;
	customFields?: Record<string, any>;
	filter?: any;
	pagination?: any;
};

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
	// 1:m relationship filter — filter Fellowship by a field on its Members (Person)
	{
		name: 'filter-rel-fellowship-members-race',
		fields: { id: {}, name: {} },
		entity: Fellowship,
		filter: { members: { race: 'Elf' } } as any,
	},
	// m:m relationship filter — filter Person by a field on their Battles
	{
		name: 'filter-rel-person-battles-outcome',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { battles: { outcome: 'Victory' } } as any,
	},
	// Compound _and containing a relationship sub-filter
	{
		name: 'filter-and-with-rel',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: {
			_and: [{ fellowship: { name: 'Fellowship of the Ring' } }, { age_gt: 30 }],
		} as any,
	},
	// Compound _or containing a relationship sub-filter
	{
		name: 'filter-or-with-rel',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: {
			_or: [{ fellowship: { name: 'Fellowship of the Ring' } }, { ring: { name: 'The One Ring' } }],
		} as any,
	},

	// ── Advanced filter operators ─────────────────────────────────────────
	// _between operator — { age_between: [low, high] }
	{
		name: 'filter-between-age',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { age_between: [30, 200] } as any,
	},
	// _fulltext operator — Postgres tsvector full-text search
	{
		name: 'filter-fulltext-name',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { name_fulltext: 'hobbit' } as any,
	},
	// _overlap — array overlap operator (ARRAY && ARRAY)
	{
		name: 'filter-overlap-race',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { race_overlap: ['Elf', 'Hobbit'] } as any,
	},
	// _contains — array containment operator (ARRAY @> ARRAY)
	{
		name: 'filter-contains-race',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { race_contains: 'Elf' } as any,
	},

	// ── _not class operation ──────────────────────────────────────────────
	// Simple _not — negate a single condition
	{
		name: 'filter-not-simple',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { _not: [{ name: 'Frodo' }] } as any,
	},
	// _not with multiple conditions — NOT (cond1 AND cond2)
	{
		name: 'filter-not-multi',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { _not: [{ name: 'Frodo' }, { race: 'Hobbit' }] } as any,
	},
	// _not combined with a regular field filter
	{
		name: 'filter-not-with-other',
		fields: { id: {}, name: {} },
		entity: Person,
		filter: { age_gt: 50, _not: [{ race: 'Orc' }] } as any,
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
	// NOTE: count-author-bookcount-filter omitted — filtering by bookCount_gt
	// requires the count field registered via @GQLEntityClass decorators, which
	// the bare mock-metadata fixture doesn't set up. Covered in count-field.test.ts instead.

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

describe('SQL regression — golden snapshots', () => {
	const provider = createMockMetadataProvider();
	const mapper = new GQLtoSQLMapper(provider);

	for (const s of scenarios) {
		it(`generate identical SQL for ${s.name}`, () => {
			const result = mapper.buildQueryAndBindingsFor({
				fields: s.fields,
				entity: s.entity,
				customFields: s.customFields ?? {},
				filter: s.filter,
				pagination: s.pagination,
			});
			expect(normalize(result.querySQL)).toBe(goldenSQL[s.name]);
		});
	}
});
