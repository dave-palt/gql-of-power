/**
 * Unit tests for the FieldOperations leaf module — the primitive filter
 * operator functions that emit WHERE-clause fragments + bound value maps.
 *
 * These operators were previously only exercised indirectly through the
 * filter-processor (62% coverage). This suite pins every operator's exact
 * output so the shared array-binding pattern can be refactored safely.
 *
 * Call signature (matching filter-processor usage):
 *   opFunc([leftRef, rightRef, ..._], [_, value1, value2, ...])
 */
import { describe, expect, it } from 'bun:test';
import { FieldOperations } from '../../src/field-operations';
import '../setup';

// Use a named-parameter style right ref like the filter-processor does:
// the right ref's leading sigil is stripped to form the value key.
const R = ':ring';

describe('FieldOperations', () => {
	describe('comparison operators (no value override)', () => {
		it('_eq emits "= R" for non-null, "is null" for null', () => {
			expect(FieldOperations._eq(['e.id', R], ['', 1])).toEqual({
				where: 'e.id = :ring',
				value: undefined,
			});
			expect(FieldOperations._eq(['e.id', R], ['', null])).toEqual({
				where: 'e.id is null',
				value: undefined,
			});
			expect(FieldOperations._eq(['e.id', R], ['', 'null'])).toEqual({
				where: 'e.id is null',
				value: undefined,
			});
		});

		it('_ne emits "!= R" for non-null, "is not null" for null', () => {
			expect(FieldOperations._ne(['e.id', R], ['', 1])).toEqual({
				where: 'e.id != :ring',
				value: undefined,
			});
			expect(FieldOperations._ne(['e.id', R], ['', null])).toEqual({
				where: 'e.id is not null',
				value: undefined,
			});
		});

		it('_gt/_gte/_lt/_lte emit bare comparisons', () => {
			expect(FieldOperations._gt(['e.age', R], []).where).toBe('e.age > :ring');
			expect(FieldOperations._gte(['e.age', R], []).where).toBe('e.age >= :ring');
			expect(FieldOperations._lt(['e.age', R], []).where).toBe('e.age < :ring');
			expect(FieldOperations._lte(['e.age', R], []).where).toBe('e.age <= :ring');
			for (const op of ['_gt', '_gte', '_lt', '_lte'] as const) {
				expect(FieldOperations[op](['e.age', R], []).value).toBeUndefined();
			}
		});

		it('_like/_re/_ilike emit pattern operators', () => {
			expect(FieldOperations._like(['e.name', R], []).where).toBe('e.name like :ring');
			expect(FieldOperations._ilike(['e.name', R], []).where).toBe('e.name ilike :ring');
			expect(FieldOperations._re(['e.name', R], []).where).toBe('e.name ~ :ring');
		});

		it('_nlike/_nilike/_nre emit negated pattern operators', () => {
			expect(FieldOperations._nlike(['e.name', R], []).where).toBe('e.name not like :ring');
			expect(FieldOperations._nilike(['e.name', R], []).where).toBe('e.name not ilike :ring');
			expect(FieldOperations._nre(['e.name', R], []).where).toBe('e.name !~ :ring');
		});

		it('_startsWith/_istartsWith append a wildcard to the right', () => {
			expect(FieldOperations._startsWith(['e.name', R], []).where).toBe("e.name like :ring || '%'");
			expect(FieldOperations._istartsWith(['e.name', R], []).where).toBe(
				"e.name ilike :ring || '%'"
			);
		});

		it('_endsWith/_iendsWith prepend a wildcard to the right', () => {
			expect(FieldOperations._endsWith(['e.name', R], []).where).toBe("e.name like '%' || :ring");
			expect(FieldOperations._iendsWith(['e.name', R], []).where).toBe("e.name ilike '%' || :ring");
		});

		it('_is_null emits "is null" for true, "is not null" for false', () => {
			expect(FieldOperations._is_null(['e.age', R], ['', true]).where).toBe('e.age is null');
			expect(FieldOperations._is_null(['e.age', R], ['', false]).where).toBe('e.age is not null');
		});

		it('_fulltext emits tsvector @@ tsquery', () => {
			expect(FieldOperations._fulltext(['e.body', R], []).where).toBe(
				'e.body::tsvector @@ :ring::tsquery'
			);
		});
	});

	describe('array operators (value-binding reduce pattern)', () => {
		it('_in builds an IN-list and a value map keyed by R__<i>', () => {
			const { where, value } = FieldOperations._in(['e.id', R, 'x'], ['', 1, 2, 3]);
			expect(where).toBe('e.id in (:ring__0, :ring__1, :ring__2)');
			expect(value).toEqual({ ring__0: 1, ring__1: 2, ring__2: 3 });
		});

		it('_nin builds a NOT IN-list with the same value pattern', () => {
			const { where, value } = FieldOperations._nin(['e.id', R, 'x'], ['', 7, 8]);
			expect(where).toBe('e.id not in (:ring__0, :ring__1)');
			expect(value).toEqual({ ring__0: 7, ring__1: 8 });
		});

		it('_contains builds an ARRAY containment check', () => {
			const { where, value } = FieldOperations._contains(['e.tags', R, 'x'], ['', 'a', 'b']);
			expect(where).toBe('ARRAY[e.tags] @> ARRAY[:ring__0, :ring__1]');
			expect(value).toEqual({ ring__0: 'a', ring__1: 'b' });
		});

		it('_in/_nin/_contains produce an empty value map for no values', () => {
			const { where, value } = FieldOperations._in(['e.id', R, 'x'], ['']);
			expect(where).toBe('e.id in ()');
			expect(value).toEqual({});
		});
	});

	describe('remaining operators', () => {
		it('_overlap emits an ARRAY overlap check', () => {
			expect(FieldOperations._overlap(['e.tags', R], [])).toEqual({
				where: 'ARRAY[e.tags] && ARRAY[:ring]',
				value: undefined,
			});
		});

		it('_contained emits a contained check', () => {
			expect(FieldOperations._contained(['e.tags', R], [])).toEqual({
				where: 'e.tags contained :ring',
				value: undefined,
			});
		});

		it('_between emits a BETWEEN ... AND ...', () => {
			expect(FieldOperations._between(['e.age', ':lo', ':hi'], [])).toEqual({
				where: 'e.age between :lo and :hi',
				value: undefined,
			});
		});

		it('_nbetween emits a NOT BETWEEN ... AND ...', () => {
			expect(FieldOperations._nbetween(['e.age', ':lo', ':hi'], [])).toEqual({
				where: 'e.age not between :lo and :hi',
				value: undefined,
			});
		});

		it('_exists emits "exists L"', () => {
			expect(FieldOperations._exists(['(subquery)'], [])).toEqual({
				where: 'exists (subquery)',
				value: undefined,
			});
		});

		it('_and wraps the left fragment in and (...)', () => {
			expect(FieldOperations._and(['a = b'], [null])).toEqual({
				where: 'and (a = b)',
				value: undefined,
			});
		});
	});
});
