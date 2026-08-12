/**
 * Regression tests for inline (field-argument) filter enum conversion.
 *
 * Bug: `convertFilterEnumValues` was applied to TOP-LEVEL filters (in
 * GQLQueryManager) but NOT to inline filter args on nested relation
 * selections — e.g. `rings { bearer(filter: { questState: InProgress }) { ... } }`.
 * The `questState: 'InProgress'` string key bypassed conversion and was
 * passed straight to SQL generation, silently failing the WHERE clause for
 * mapNumericEnum fields at any nesting level.
 *
 * Fix: `handleFieldArguments` and `mapCountField` in gql-to-sql-mapper.ts
 * now call `convertFilterEnumValues` on the inline filter args before SQL
 * generation.
 *
 * These tests exercise the FULL GQL layer (GQLQueryManager → mapper →
 * SQLBuilder) with a mocked DB that captures the generated SQL + bindings,
 * verifying that enum string keys are converted to raw numeric DB values.
 * Additional SQL-level tests validate convertFilterEnumValues directly on
 * the wrapped filter shape used by handleFieldArguments.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
	clearMapEnumFields,
	defineFields,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import { convertFilterEnumValues } from '../../src/queries/enum-filter-converter';
import { GQLQueryManager } from '../../src/query-manager';
import {
	EntityMetadata,
	EntityProperty,
	FieldSelection,
	ReferenceType,
	RelationOwnership,
} from '../../src/types';
import '../setup';

// ─── LOTR enums ───────────────────────────────────────────────────────────
// DB stores numeric codes; GraphQL exposes string keys.
enum RingStatus {
	Forged = 100,
	Lost = 200,
	Destroyed = 300,
}

enum QuestState {
	NotStarted = 0,
	InProgress = 1,
	Completed = 2,
	Failed = 3,
}

enum WeaponStatus {
	Worthy = 913710000,
	Corrupted = 913710001,
	Shattered = 913710002,
}

// ─── ORM classes ──────────────────────────────────────────────────────────
class TestRing {
	id!: number;
	name!: string;
	status!: number; // RingStatus — numeric in DB
	bearerId?: number;
	bearer?: TestBearer;
}

class TestBearer {
	id!: number;
	name!: string;
	ringId?: number;
	ring?: TestRing; // m:1 relation to ring
	questState!: number; // QuestState — numeric in DB
	weaponId?: number;
	weapon?: TestWeapon;
}

class TestWeapon {
	id!: number;
	weaponName!: string;
	status!: number; // WeaponStatus — numeric in DB
}

// ─── Entity metadata ──────────────────────────────────────────────────────
const createProperty = (
	type: string,
	name: string,
	fieldNames: string[],
	reference?: { referenceType: ReferenceType } & RelationOwnership
): EntityProperty => ({
	type,
	name,
	fieldNames,
	...reference,
	joinColumns: [],
	referencedColumnNames: [],
	inverseJoinColumns: [],
	pivotTable: '',
	reference: reference?.referenceType,
});

const TestRingMetadata: EntityMetadata<TestRing> = {
	name: 'TestRing',
	tableName: 'test_rings',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['ring_name']),
		status: createProperty('number', 'status', ['status']),
		bearerId: createProperty('number', 'bearerId', ['bearer_id']),
		bearer: createProperty('TestBearer', 'bearer', ['bearer_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
		}),
	},
};

const TestBearerMetadata: EntityMetadata<TestBearer> = {
	name: 'TestBearer',
	tableName: 'test_bearers',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['bearer_name']),
		ringId: createProperty('number', 'ringId', ['ring_id']),
		ring: createProperty('TestRing', 'ring', ['ring_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
		}),
		questState: createProperty('number', 'questState', ['quest_state']),
		weaponId: createProperty('number', 'weaponId', ['weapon_id']),
		weapon: createProperty('TestWeapon', 'weapon', ['weapon_id'], {
			referenceType: ReferenceType.MANY_TO_ONE,
		}),
	},
};

const TestWeaponMetadata: EntityMetadata<TestWeapon> = {
	name: 'TestWeapon',
	tableName: 'test_weapons',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		weaponName: createProperty('string', 'weaponName', ['weapon_name']),
		status: createProperty('number', 'status', ['status']),
	},
};

setGlobalConfig({ gqlTypesSuffix: '' });

function createMockProvider() {
	return {
		client: 'pg',
		exists: (name: string) => name === 'TestBearer' || name === 'TestRing' || name === 'TestWeapon',
		getMetadata: <T, K>(entityName: string): K => {
			if (entityName === 'TestBearer') return TestBearerMetadata as K;
			if (entityName === 'TestRing') return TestRingMetadata as K;
			if (entityName === 'TestWeapon') return TestWeaponMetadata as K;
			throw new Error(`Unknown entity: ${entityName}`);
		},
		rawQuery: (sql: string, bindings?: any) => sql,
		executeQuery: async () => [],
	};
}

/**
 * Register TestBearer (with questState mapNumericEnum) and TestRing (with
 * bearer → TestBearer relation). Returns nothing; the @GQLEntityClass side
 * effects populate the global registries (MapEnumFieldsMap, RelationFieldsMap).
 */
function registerBearerAndRing() {
	const bearerFields = defineFields(TestBearer, {
		id: { type: () => Number, generateFilter: true },
		name: { type: () => String, generateFilter: true },
		questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
	});
	@GQLEntityClass(TestBearer, bearerFields)
	class TestBearerGQL extends GQLEntityBase {}

	const ringFields = defineFields(TestRing, {
		id: { type: () => Number, generateFilter: true },
		name: { type: () => String, generateFilter: true },
		status: { type: () => RingStatus, generateFilter: true, mapNumericEnum: true },
		bearer: {
			type: () => TestBearerGQL,
			options: { nullable: true },
			generateFilter: true,
			relatedEntityName: () => 'TestBearer',
		},
	});
	@GQLEntityClass(TestRing, ringFields)
	class TestRingGQL extends GQLEntityBase {}
}

// ─── Full GQL-layer tests (mocked DB, captures generated SQL bindings) ────

describe('Inline field-argument filter — mapNumericEnum conversion (full GQL layer)', () => {
	let queryManager: GQLQueryManager;
	let capturedBindings: any;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
		capturedBindings = {};
	});

	/**
	 * Run a query selecting rings with an INLINE filter on the `bearer`
	 * relation field (simulating `rings { bearer(filter: {...}) { ... } }`).
	 * Captures bindings to assert enum keys were converted to numeric DB values.
	 */
	async function runInlineBearerFilterQuery(inlineFilter: any): Promise<void> {
		registerBearerAndRing();

		const provider = {
			...createMockProvider(),
			rawQuery: (sql: string, bindings: any) => {
				capturedBindings = bindings;
				return sql;
			},
			executeQuery: async () => [],
		};

		const info = {
			id: {},
			name: {},
			bearer: {
				args: { filter: inlineFilter },
				fieldsByTypeName: {
					TestBearer: { id: {}, name: {} },
				},
			},
		} as FieldSelection<any>;

		await queryManager.getQueryResultsForFields(provider as any, TestRing as any, info, undefined);
	}

	it('converts enum key in inline filter on relation field: bearer(filter: { questState: InProgress })', async () => {
		await runInlineBearerFilterQuery({ questState_eq: 'InProgress' });
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(1); // QuestState.InProgress = 1
	});

	it('converts enum key in inline filter with _in operator', async () => {
		await runInlineBearerFilterQuery({ questState_in: ['NotStarted', 'Completed'] });
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(0); // NotStarted
		expect(bindingValues).toContain(2); // Completed
	});

	it('converts enum key in inline filter with object operator shape: { questState: { _eq: InProgress } }', async () => {
		await runInlineBearerFilterQuery({ questState: { _eq: 'InProgress' } });
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(1); // InProgress
	});

	it('passes through non-enum scalar filters in inline args unchanged', async () => {
		await runInlineBearerFilterQuery({ name_eq: 'Frodo Baggins' });
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain('Frodo Baggins');
	});

	it('converts enum keys in _or arrays inside inline filter args', async () => {
		await runInlineBearerFilterQuery({
			_or: [{ questState_eq: 'NotStarted' }, { questState_eq: 'Failed' }],
		});
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(0); // NotStarted
		expect(bindingValues).toContain(3); // Failed
	});

	it('handles mixed enum + scalar filters in inline args simultaneously', async () => {
		await runInlineBearerFilterQuery({
			name_eq: 'Frodo',
			questState_eq: 'Completed',
		});
		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain('Frodo');
		expect(bindingValues).toContain(2); // Completed
	});
});

// ─── SQL-level tests (convertFilterEnumValues on wrapped shape) ───────────

describe('Inline field-argument filter — SQL-level convertFilterEnumValues (wrapped shape)', () => {
	/**
	 * These tests call convertFilterEnumValues directly on the WRAPPED filter
	 * shape that handleFieldArguments uses internally: the inline filter is
	 * wrapped under the relation field name, e.g. `{ bearer: { questState_eq: 'InProgress' } }`.
	 * The parent entity's relation-field registry resolves `bearer` → TestBearer,
	 * then recurses into TestBearer's enum fields.
	 */
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('converts enum key through wrapped relation field at depth 1', () => {
		const bearerFields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});
		@GQLEntityClass(TestBearer, bearerFields)
		class TestBearerGQL extends GQLEntityBase {}
		void TestBearerGQL;

		const relationFields = {
			bearer: () => 'TestBearer',
		};
		const wrapped = { bearer: { questState_eq: 'InProgress' } };
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.bearer).toEqual({ questState_eq: 1 }); // QuestState.InProgress = 1
	});

	it('converts enum key through wrapped relation field at depth 2 (ring.bearer.questState)', () => {
		// Register TestBearer with questState (mapNumericEnum), then TestRing
		// with bearer → TestBearer. The wrapped filter { bearer: { questState_eq } }
		// uses TestRing's relation registry to resolve bearer → TestBearer.
		const bearerFields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});
		@GQLEntityClass(TestBearer, bearerFields)
		class TestBearerGQL extends GQLEntityBase {}

		const ringFields = defineFields(TestRing, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			bearer: {
				type: () => TestBearerGQL,
				options: { nullable: true },
				generateFilter: true,
				relatedEntityName: () => 'TestBearer',
			},
		});
		@GQLEntityClass(TestRing, ringFields)
		class TestRingGQL extends GQLEntityBase {}
		void TestRingGQL;

		const relationFields = {
			bearer: () => 'TestBearer',
		};
		const wrapped = { bearer: { questState_eq: 'Completed' } };
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.bearer).toEqual({ questState_eq: 2 }); // QuestState.Completed = 2
	});

	it('converts enum key through wrapped relation field with _in array', () => {
		const weaponFields = defineFields(TestWeapon, {
			id: { type: () => String, generateFilter: true },
			weaponName: { type: () => String, generateFilter: true },
			status: { type: () => WeaponStatus, generateFilter: true, mapNumericEnum: true },
		});
		@GQLEntityClass(TestWeapon, weaponFields)
		class TestWeaponGQL extends GQLEntityBase {}
		void TestWeaponGQL;

		const relationFields = {
			weapon: () => 'TestWeapon',
		};
		const wrapped = { weapon: { status_in: ['Worthy', 'Shattered'] } };
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.weapon).toEqual({ status_in: [913710000, 913710002] });
	});

	it('passes through unknown keys in wrapped relation filter unchanged', () => {
		const relationFields = {
			ring: () => 'TestRing',
		};
		const wrapped = { unknownField: { someKey: 'value' } };
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.unknownField).toEqual({ someKey: 'value' });
	});

	it('converts through PascalCase relation field key (Bearer)', () => {
		const bearerFields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});
		@GQLEntityClass(TestBearer, bearerFields)
		class TestBearerGQL extends GQLEntityBase {}
		void TestBearerGQL;

		// PascalCase key `Bearer` should resolve to relation field `bearer` → TestBearer
		const relationFields = {
			Bearer: () => 'TestBearer',
		};
		const wrapped = { Bearer: { questState_eq: 'Failed' } };
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.Bearer).toEqual({ questState_eq: 3 }); // QuestState.Failed = 3
	});

	it('converts _or arrays through wrapped relation field recursively', () => {
		const bearerFields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});
		@GQLEntityClass(TestBearer, bearerFields)
		class TestBearerGQL extends GQLEntityBase {}
		void TestBearerGQL;

		const relationFields = {
			bearer: () => 'TestBearer',
		};
		const wrapped = {
			bearer: {
				_or: [{ questState_eq: 'NotStarted' }, { questState_eq: 'Failed' }],
			},
		};
		const result = convertFilterEnumValues(wrapped, {}, undefined, relationFields);

		expect(result.bearer._or).toEqual([{ questState_eq: 0 }, { questState_eq: 3 }]);
	});
});
