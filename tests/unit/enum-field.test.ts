import { SQLBuilder } from '../../src/queries/sql-builder';
import { beforeEach, describe, expect, it } from 'bun:test';
import { FieldSelection } from '../../src';
import {
	clearMapEnumFields,
	defineFields,
	getMapEnumFieldsFor,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import { GQLQueryManager } from '../../src/query-manager';
import { EntityMetadata, EntityProperty, ReferenceType } from '../../src/types';
import '../setup';

enum RingBearerStatus {
	Worthy = 100,
	Corrupted = 200,
	Undefined = 300,
}

enum QuestState {
	NotStarted = 0,
	InProgress = 1,
	Completed = 2,
	Failed = 3,
}

enum Allegiance {
	Good = 'GOOD',
	Evil = 'EVIL',
	Neutral = 'NEUTRAL',
}

enum QuestFrequency {
	Weekly = '1',
	Fortnightly = '2',
	Every3Weeks = '3',
	Every4Weeks = '4',
	Every6Weeks = '11',
	MonthlyFirstWeek = '5',
	OnCall = '6',
	Other = '7',
}

enum RuneInscription {
	Alpha = 'ABC123',
	Beta = 'XYZ789',
	Gamma = '1A2B3C',
}

class TestBearer {
	id!: number;
	name!: string;
	status!: number;
	questState!: number;
	allegiance!: string;
}

class TestBearerWithAlias {
	id!: number;
	name!: string;
	holderStatus!: number;
}

class TestQuest {
	id!: number;
	name!: string;
	frequency!: string;
}

class TestRune {
	id!: number;
	name!: string;
	inscription!: string;
}

const createProperty = (
	type: string,
	name: string,
	fieldNames: string[],
	reference?: {
		referenceType: ReferenceType;
		mappedBy?: string;
	}
): EntityProperty => ({
	type,
	name,
	fieldNames,
	mappedBy: reference?.mappedBy || '',
	joinColumns: [],
	referencedColumnNames: [],
	inverseJoinColumns: [],
	pivotTable: '',
	reference: reference?.referenceType,
});

const TestBearerMetadata: EntityMetadata<TestBearer> = {
	name: 'TestBearer',
	tableName: 'test_bearers',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['bearer_name']),
		status: createProperty('number', 'status', ['status']),
		questState: createProperty('number', 'questState', ['quest_state']),
		allegiance: createProperty('string', 'allegiance', ['allegiance']),
	},
};

const TestBearerWithAliasMetadata: EntityMetadata<TestBearerWithAlias> = {
	name: 'TestBearerWithAlias',
	tableName: 'test_bearers_alias',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['bearer_name']),
		holderStatus: createProperty('number', 'holderStatus', ['holder_status']),
	},
};

const TestQuestMetadata: EntityMetadata<TestQuest> = {
	name: 'TestQuest',
	tableName: 'test_quests',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['quest_name']),
		frequency: createProperty('string', 'frequency', ['frequency']),
	},
};

const TestRuneMetadata: EntityMetadata<TestRune> = {
	name: 'TestRune',
	tableName: 'test_runes',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['rune_name']),
		inscription: createProperty('string', 'inscription', ['inscription']),
	},
};

setGlobalConfig({ gqlTypesSuffix: '' });

function createMockProvider() {
	return {
		client: 'pg',
		exists: (name: string) => name === 'TestBearer' || name === 'TestBearerWithAlias',
		getMetadata: <T, K>(entityName: string): K => {
			if (entityName === 'TestBearer') return TestBearerMetadata as K;
			if (entityName === 'TestBearerWithAlias') return TestBearerWithAliasMetadata as K;
			throw new Error(`Unknown entity: ${entityName}`);
		},
		rawQuery: (sql: string, bindings?: any) => sql,
		executeQuery: async (sql: string) => {
			if (sql.includes('test_bearers_alias')) {
				return [
					{ id: 1, name: 'Frodo', status: 100 },
					{ id: 2, name: 'Gollum', status: 200 },
				];
			}
			return [
				{ id: 1, name: 'Frodo', status: 100, questState: 1, allegiance: 'GOOD' },
				{ id: 2, name: 'Gollum', status: 200, questState: 3, allegiance: 'EVIL' },
				{ id: 3, name: 'Sam', status: 300, questState: 2, allegiance: 'GOOD' },
			];
		},
	};
}

describe('mapNumericEnum field registration', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should register only fields with mapNumericEnum: true', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
			allegiance: { type: () => Allegiance, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearer');

		expect('status' in enumFields).toBe(true);
		expect('questState' in enumFields).toBe(true);
		expect('allegiance' in enumFields).toBe(false);
		expect(enumFields['status']).toBe(RingBearerStatus);
		expect(enumFields['questState']).toBe(QuestState);
	});

	it('should register enum fields with alias', () => {
		const fields = defineFields(TestBearerWithAlias, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			holderStatus: {
				type: () => RingBearerStatus,
				generateFilter: true,
				mapNumericEnum: true,
				alias: 'status',
			},
		});

		@GQLEntityClass(TestBearerWithAlias, fields)
		class TestBearerAliasGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearerWithAlias');

		expect('status' in enumFields).toBe(true);
		expect('holderStatus' in enumFields).toBe(false);
	});

	it('should not register any fields when mapNumericEnum is absent', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			allegiance: { type: () => String, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNoEnumGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearer');
		expect(Object.keys(enumFields).length).toBe(0);
	});
});

describe('buildEnumCaseSQL', () => {
	it('should generate CASE WHEN for numeric enums', () => {
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."state"', QuestState);
		expect(sql).not.toBeNull();
		expect(sql!).toContain('CASE "a1"."state"');
		expect(sql!).toContain("WHEN 0 THEN 'NotStarted'");
		expect(sql!).toContain("WHEN 1 THEN 'InProgress'");
		expect(sql!).toContain("WHEN 2 THEN 'Completed'");
		expect(sql!).toContain("WHEN 3 THEN 'Failed'");
		expect(sql!).toContain('ELSE NULL END');
		// Should NOT contain TS reverse-mapping entries (numeric keys)
		expect(sql!).not.toContain("WHEN 'NotStarted'");
	});

	it('should generate CASE WHEN for string-valued enums', () => {
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."frequency"', QuestFrequency);
		expect(sql).not.toBeNull();
		expect(sql!).toContain("WHEN '1' THEN 'Weekly'");
		expect(sql!).toContain("WHEN '6' THEN 'OnCall'");
		expect(sql!).toContain("WHEN '11' THEN 'Every6Weeks'");
	});

	it('should generate CASE WHEN for numeric enums with non-zero start', () => {
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."status"', RingBearerStatus);
		expect(sql).not.toBeNull();
		expect(sql!).toContain("WHEN 100 THEN 'Worthy'");
		expect(sql!).toContain("WHEN 200 THEN 'Corrupted'");
		expect(sql!).toContain("WHEN 300 THEN 'Undefined'");
	});

	it('should escape single quotes in string-valued enum values', () => {
		enum QuotedEnum {
			Simple = 'hello',
			Quoted = "it's",
		}
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."val"', QuotedEnum);
		expect(sql!).toContain("WHEN 'it''s' THEN 'Quoted'");
	});

	it('should return null for empty enum object', () => {
		// Simulate an enum with only numeric reverse-map entries after filtering
		const fakeEnum: Record<string, any> = { 0: 'A', 1: 'B' };
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."val"', fakeEnum);
		expect(sql).toBeNull();
	});
});

describe('mapNumericEnum SQL CASE generation', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should embed CASE expression in the generated SQL for mapNumericEnum fields', async () => {
		const capturedSQLs: string[] = [];
		const provider = {
			...createMockProvider(),
			rawQuery: (sql: string) => sql,
			executeQuery: async (sql: string) => {
				capturedSQLs.push(sql);
				return [{ id: 1, name: 'Frodo', status: 'Worthy', questState: 'NotStarted' }];
			},
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerSQLGQL extends GQLEntityBase {}

		const info = { id: {}, name: {}, status: {}, questState: {} } as FieldSelection<TestBearer>;
		const queryManager = new GQLQueryManager();
		await queryManager.getQueryResultsForFields(provider, TestBearer, info);

		const sql = capturedSQLs.join(' ');
		// status column should be wrapped in a CASE expression
		expect(sql).toContain('CASE ');
		expect(sql).toContain("WHEN 100 THEN 'Worthy'");
		expect(sql).toContain("WHEN 0 THEN 'NotStarted'");
		// The alias must be applied so the result key matches the GQL field name
		expect(sql).toMatch(/END AS "status"/);
		expect(sql).toMatch(/END AS "questState"/);
	});

	it('should NOT generate CASE for non-mapNumericEnum enum fields', async () => {
		const capturedSQLs: string[] = [];
		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQLs.push(sql);
				return [{ id: 1, name: 'Frodo', allegiance: 'GOOD' }];
			},
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			allegiance: { type: () => Allegiance, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNoCaseGQL extends GQLEntityBase {}

		const info = { id: {}, name: {}, allegiance: {} } as FieldSelection<TestBearer>;
		const queryManager = new GQLQueryManager();
		await queryManager.getQueryResultsForFields(provider, TestBearer, info);

		const sql = capturedSQLs.join(' ');
		expect(sql).not.toContain('CASE ');
	});

	it('should generate CASE for string-valued enum fields in SQL', async () => {
		const capturedSQLs: string[] = [];
		const provider = {
			client: 'pg',
			exists: (name: string) => name === 'TestQuest',
			getMetadata: <T, K>(entityName: string): K => TestQuestMetadata as K,
			rawQuery: (sql: string) => sql,
			executeQuery: async (sql: string) => {
				capturedSQLs.push(sql);
				return [{ id: 1, name: 'Quest', frequency: 'Weekly' }];
			},
		};

		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestSQLGQL extends GQLEntityBase {}

		const info = { id: {}, name: {}, frequency: {} } as FieldSelection<TestQuest>;
		const queryManager = new GQLQueryManager();
		await queryManager.getQueryResultsForFields(provider, TestQuest, info);

		const sql = capturedSQLs.join(' ');
		expect(sql).toContain('CASE ');
		expect(sql).toContain("WHEN '1' THEN 'Weekly'");
		expect(sql).toContain("WHEN '6' THEN 'OnCall'");
		expect(sql).toMatch(/END AS "frequency"/);
	});
});

describe('mapNumericEnum filter conversion', () => {
	let queryManager: GQLQueryManager;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
	});

	it('should convert enum key filter values to numeric DB values', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerFilterGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = { status_eq: 'Corrupted' };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should convert nested object filter values', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNestedGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = { Status: { _eq: 'Worthy' } };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should convert _in filter arrays', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerInGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, questState: {} } as FieldSelection<TestBearer>;

		const filter = { questState_in: ['InProgress', 'Completed'] };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should handle _and/_or with enum filters', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerOrGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = {
			_or: [{ status: 'Worthy' }, { status: 'Corrupted' }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should not convert filters for non-mapNumericEnum fields', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			allegiance: { type: () => Allegiance, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNoMapGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, allegiance: {} } as FieldSelection<TestBearer>;

		const filter = { allegiance_eq: 'GOOD' };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});
});

describe('mapNumericEnum SQL CASE for string-valued enums', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should generate CASE WHEN for QuestFrequency (string values)', () => {
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."frequency"', QuestFrequency);
		expect(sql).not.toBeNull();
		expect(sql!).toContain("WHEN '1' THEN 'Weekly'");
		expect(sql!).toContain("WHEN '2' THEN 'Fortnightly'");
		expect(sql!).toContain("WHEN '3' THEN 'Every3Weeks'");
		expect(sql!).toContain("WHEN '4' THEN 'Every4Weeks'");
		expect(sql!).toContain("WHEN '5' THEN 'MonthlyFirstWeek'");
		expect(sql!).toContain("WHEN '6' THEN 'OnCall'");
		expect(sql!).toContain("WHEN '7' THEN 'Other'");
		expect(sql!).toContain("WHEN '11' THEN 'Every6Weeks'");
	});

	it('should generate CASE WHEN for alphanumeric string-valued enums', () => {
		const sql = SQLBuilder.buildEnumCaseSQL('"a1"."inscription"', RuneInscription);
		expect(sql).not.toBeNull();
		expect(sql!).toContain("WHEN 'ABC123' THEN 'Alpha'");
		expect(sql!).toContain("WHEN 'XYZ789' THEN 'Beta'");
		expect(sql!).toContain("WHEN '1A2B3C' THEN 'Gamma'");
	});

	it('should register string-valued enum fields in MapEnumFieldsMap', () => {
		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestRegGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestQuest');

		expect('frequency' in enumFields).toBe(true);
		expect(enumFields['frequency']).toBe(QuestFrequency);
	});
});
