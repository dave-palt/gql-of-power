/**
 * Unit tests for string-form orderBy normalization + GQLOrderBySpec scalar (issue #68).
 */
import { describe, expect, it } from 'bun:test';
import { Kind } from 'graphql';
import {
	GQLOrderBySpecScalar,
	normalizeOrderBy,
	parseOrderByString,
} from '../../src/queries/normalize-orderby';

describe('normalize-orderby (unit)', () => {
	describe('parseOrderByString', () => {
		it('defaults to asc when no direction suffix', () => {
			expect(parseOrderByString('title')).toEqual({ title: 'asc' });
		});

		it('parses an explicit direction suffix (case-insensitive)', () => {
			expect(parseOrderByString('title desc')).toEqual({ title: 'desc' });
			expect(parseOrderByString('title ASC')).toEqual({ title: 'asc' });
			expect(parseOrderByString('title DeSc')).toEqual({ title: 'desc' });
		});

		it('parses one relation hop into the nested-object form', () => {
			expect(parseOrderByString('author.name')).toEqual({ author: { name: 'asc' } });
			expect(parseOrderByString('author.name desc')).toEqual({ author: { name: 'desc' } });
		});

		it('tolerates surrounding whitespace', () => {
			expect(parseOrderByString('  author.name   desc  ')).toEqual({ author: { name: 'desc' } });
		});

		it('throws on empty / non-string input', () => {
			expect(() => parseOrderByString('')).toThrow();
			expect(() => parseOrderByString('   ')).toThrow();
			expect(() => parseOrderByString(undefined as any)).toThrow();
		});

		it('throws on invalid identifiers', () => {
			expect(() => parseOrderByString('auth-or.name')).toThrow();
			expect(() => parseOrderByString('title sideways')).toThrow();
			expect(() => parseOrderByString('a..b')).toThrow();
		});

		it('throws with a dedicated message for multi-hop paths', () => {
			try {
				parseOrderByString('cuisine.parent.name');
				throw new Error('should have thrown');
			} catch (e: any) {
				expect(e.message).toContain('one relation hop');
			}
		});
	});

	describe('normalizeOrderBy', () => {
		it('returns undefined for undefined/null input', () => {
			expect(normalizeOrderBy(undefined)).toBeUndefined();
			expect(normalizeOrderBy(null as any)).toBeUndefined();
		});

		it('converts strings and passes objects through in mixed arrays', () => {
			const out = normalizeOrderBy(['title desc', { author: { name: 'asc' } }, 'id']);
			expect(out).toEqual([{ title: 'desc' }, { author: { name: 'asc' } }, { id: 'asc' }]);
		});

		it('throws on unsupported element types', () => {
			expect(() => normalizeOrderBy([42 as any])).toThrow();
			expect(() => normalizeOrderBy([['title'] as any])).toThrow();
		});
	});

	describe('GQLOrderBySpecScalar', () => {
		it('parseValue validates strings eagerly and returns them unchanged', () => {
			expect(GQLOrderBySpecScalar.parseValue!('author.name desc')).toBe('author.name desc');
			expect(() => GQLOrderBySpecScalar.parseValue!('a.b.c.d')).toThrow();
		});

		it('parseValue passes objects through', () => {
			const obj = { title: 'asc' };
			expect(GQLOrderBySpecScalar.parseValue!(obj)).toBe(obj);
		});

		it('parseValue rejects other types', () => {
			expect(() => GQLOrderBySpecScalar.parseValue!(42)).toThrow();
		});

		it('parseLiteral accepts string literals (with eager validation)', () => {
			const ast = { kind: Kind.STRING, value: 'title desc' };
			expect(GQLOrderBySpecScalar.parseLiteral!(ast as any)).toBe('title desc');
			const bad = { kind: Kind.STRING, value: 'not a valid!!spec' };
			expect(() => GQLOrderBySpecScalar.parseLiteral!(bad as any)).toThrow();
		});

		it('parseLiteral accepts object literals with enum, string and nested values', () => {
			const ast = {
				kind: Kind.OBJECT,
				fields: [
					{ name: { kind: Kind.NAME, value: 'title' }, value: { kind: Kind.ENUM, value: 'ASC' } },
					{
						name: { kind: Kind.NAME, value: 'author' },
						value: {
							kind: Kind.OBJECT,
							fields: [
								{
									name: { kind: Kind.NAME, value: 'name' },
									value: { kind: Kind.STRING, value: 'desc' },
								},
							],
						},
					},
				],
			};
			expect(GQLOrderBySpecScalar.parseLiteral!(ast as any)).toEqual({
				title: 'ASC',
				author: { name: 'desc' },
			});
		});

		it('parseLiteral rejects other literal kinds', () => {
			expect(() =>
				GQLOrderBySpecScalar.parseLiteral!({ kind: Kind.INT, value: '1' } as any)
			).toThrow();
			expect(() =>
				GQLOrderBySpecScalar.parseLiteral!({
					kind: Kind.LIST,
					values: [],
				} as any)
			).toThrow();
		});
	});
});
