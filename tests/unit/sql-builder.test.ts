/**
 * Unit Tests for SQLBuilder
 *
 * Tests the SQL generation utilities that were extracted from GQLtoSQLMapper
 * including JSON object construction, subqueries, union all, and lateral joins.
 */

import { describe, expect, it } from 'bun:test';
import { Alias, AliasType } from '../../src';
import { SQLBuilder } from '../../src/queries/sql-builder';
import { MappingsType } from '../../src/types';
import '../setup';

describe('SQLBuilder', () => {
	describe('buildSubQuery', () => {
		it('should build basic subquery with select and from', () => {
			const result = SQLBuilder.buildSubQuery(
				['person.id', 'person.person_name'],
				'persons',
				'p1',
				[],
				[]
			);

			expect(result).toContain('select person.id, person.person_name');
			expect(result).toContain('from persons as p1');
			expect(result).toContain('where true');
		});

		it('should include global filter joins', () => {
			const globalFilterJoin = ['left join rings r on r.bearer_id = p.id'];
			const result = SQLBuilder.buildSubQuery(['person.id'], 'persons', 'p1', globalFilterJoin, []);

			expect(result).toContain('left join rings r on r.bearer_id = p.id');
		});

		it('should include where conditions', () => {
			const globalWhereJoin = ['p.race = :race', 'p.age > :min_age'];
			const result = SQLBuilder.buildSubQuery(['person.id'], 'persons', 'p1', [], globalWhereJoin);

			expect(result).toContain('and ( p.race = :race and p.age > :min_age )');
		});

		it('should handle additional filter join value', () => {
			const result = SQLBuilder.buildSubQuery(['person.id'], 'persons', 'p1', [], [], {
				filterJoin: 'inner join fellowships f on f.id = p.fellowship_id',
			});

			expect(result).toContain('inner join fellowships f on f.id = p.fellowship_id');
		});

		it('should handle additional where value', () => {
			const result = SQLBuilder.buildSubQuery(['person.id'], 'persons', 'p1', [], [], {
				where: 'p.name = :name',
			});

			expect(result).toContain('and p.name = :name');
		});
	});

	describe('buildUnionAll', () => {
		it('should build union all queries from OR conditions', () => {
			const orConditions: MappingsType[] = [
				{
					select: new Set(),
					json: [],
					join: [],
					filterJoin: ['join1'],
					where: ['where1'],
					values: {},
					orderBy: [],
					_or: [],
					_and: [],
					_not: [],
				},
				{
					select: new Set(),
					json: [],
					join: [],
					filterJoin: [],
					where: ['where2', 'where3'],
					values: {},
					orderBy: [],
					_or: [],
					_and: [],
					_not: [],
				},
			];

			let callCount = 0;
			const mockQueryBuilder = (
				fields: any,
				alias: any,
				tableName: any,
				filterJoin: any,
				join: any,
				whereSQL: any,
				whereWithValues: any,
				value?: any
			) => {
				callCount++;
				if (value && 'filterJoin' in value) {
					return `query with filterJoin: ${value.filterJoin}`;
				}
				if (value && 'where' in value) {
					return `query with where: ${value.where}`;
				}
				return 'base query';
			};

			const result = SQLBuilder.buildUnionAll(
				['field1'],
				'table1',
				new Alias(AliasType.entity, 1, 't'),
				[],
				[],
				'',
				[],
				orConditions,
				mockQueryBuilder
			);

			// Should generate queries for each filterJoin and where condition
			// First mapping has 1 filterJoin + 1 where = 2 queries
			// Second mapping has 0 filterJoin + 2 wheres = 2 queries
			// Total = 4 queries
			expect(result).toHaveLength(4);
			expect(result.some((r) => r.includes('join1'))).toBe(true);
			expect(result.some((r) => r.includes('where2'))).toBe(true);
			expect(result.some((r) => r.includes('where3'))).toBe(true);
		});

		it('should handle empty OR conditions', () => {
			let callCount = 0;
			const mockQueryBuilder = () => {
				callCount++;
				return 'query';
			};

			const result = SQLBuilder.buildUnionAll(
				['field1'],
				'table1',
				new Alias(AliasType.entity, 1, 't'),
				[],
				[],
				'',
				[],
				[],
				mockQueryBuilder
			);

			expect(result).toEqual([]);
			expect(callCount).toBe(0);
		});
	});

	describe('buildOrderBySQL', () => {
		it('should build ORDER BY SQL from orderBy array', () => {
			const orderBy: Array<Record<string, 'asc' | 'desc'>> = [
				{ name: 'asc' as const },
				{ age: 'desc' as const, race: 'asc' as const },
			];

			const fieldMapper = (field: string) => {
				const mappings: Record<string, string[]> = {
					name: ['person_name'],
					age: ['person_age'],
					race: ['person_race'],
				};
				return mappings[field] || [field];
			};

			const result = SQLBuilder.buildOrderBySQL(orderBy, fieldMapper);

			expect(result).toBe('order by person_name asc, person_age desc, person_race asc');
		});

		it('should handle multiple field names for single property', () => {
			const orderBy = [{ fullName: 'asc' as const }];
			const fieldMapper = (field: string) => {
				if (field === 'fullName') {
					return ['first_name', 'last_name'];
				}
				return [field];
			};

			const result = SQLBuilder.buildOrderBySQL(orderBy, fieldMapper);
			expect(result).toBe('order by first_name asc, last_name asc');
		});

		it('should return empty string for empty orderBy', () => {
			const fieldMapper = () => [];
			const result = SQLBuilder.buildOrderBySQL([], fieldMapper);
			expect(result).toBe('');
		});

		it('should filter out empty field mappings', () => {
			const orderBy: Array<Record<string, 'asc' | 'desc'>> = [
				{ validField: 'asc' as const },
				{ invalidField: 'desc' as const },
			];
			const fieldMapper = (field: string) => {
				return field === 'validField' ? ['valid_column'] : [];
			};

			const result = SQLBuilder.buildOrderBySQL(orderBy, fieldMapper);
			expect(result).toBe('order by valid_column asc');
		});
	});

	describe('buildLateralJoin', () => {
		it('should build lateral join with all components', () => {
			const jsonSelect = "jsonb_build_object('id', r.id, 'name', r.ring_name)";
			const fromSQL = '"rings" as r1';
			const joins = ['left join persons p on p.id = r.bearer_id'];
			const whereConditions = 'where r.bearer_id = p1.id and r.forged_by = :forger';
			const alias = 'r1';

			const result = SQLBuilder.buildLateralJoin(
				jsonSelect,
				fromSQL,
				joins,
				whereConditions,
				alias
			);

			expect(result).toContain('left outer join lateral (');
			expect(result).toContain(`select ${jsonSelect} as value`);
			expect(result).toContain(`from ${fromSQL}`);
			expect(result).toContain('left join persons p on p.id = r.bearer_id');
			expect(result).toContain(whereConditions);
			expect(result).toContain(`as ${alias} on true`);
		});

		it('should handle empty joins array', () => {
			const result = SQLBuilder.buildLateralJoin(
				'json_select',
				'from_sql',
				[],
				'where_conditions',
				'alias1'
			);

			expect(result).toContain('left outer join lateral (');
			expect(result).toContain('select json_select as value');
			expect(result).toContain('from from_sql');
			expect(result).toContain('where_conditions');
			expect(result).toContain('as alias1 on true');
		});

		it('should compress whitespace correctly', () => {
			const result = SQLBuilder.buildLateralJoin(
				'json_build_object()',
				'"table" as t1',
				['join clause'],
				'where condition',
				't1'
			);

			// Should not have excessive whitespace
			expect(result).not.toMatch(/\s{2,}/);
			expect(result).not.toContain('\n');
			expect(result).not.toContain('\t');
		});
	});

	describe('integration scenarios', () => {
		it('should handle complex Middle-earth query components', () => {
			const jsonSelect = SQLBuilder.generateJsonSelectStatement('test', true);
			expect(jsonSelect).toContain('json_agg');
			expect(jsonSelect).toContain('row_to_json(test)');

			const orderBy: Array<Record<string, 'asc' | 'desc'>> = [
				{ name: 'asc' as const },
				{ race: 'desc' as const },
			];
			const fieldMapper = (field: string) => [`p.person_${field}`];
			const orderBySQL = SQLBuilder.buildOrderBySQL(orderBy, fieldMapper);
			expect(orderBySQL).toContain('order by p.person_name asc, p.person_race desc');

			const subQuery = SQLBuilder.buildSubQuery(
				['p.id', 'p.person_name', 'p.race'],
				'persons',
				'p1',
				['left join fellowships f on f.id = p.fellowship_id'],
				['f.fellowship_name = :fellowship_name']
			);

			expect(subQuery).toContain('persons as p1');
			expect(subQuery).toContain('left join fellowships f');
			expect(subQuery).toContain('f.fellowship_name = :fellowship_name');
		});
	});
});
