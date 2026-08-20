/**
 * Explicit (programmatic) orStrategy argument vs CHILD pagination orStrategy.
 *
 * Rule (spec 2026-08-20): an explicitly passed query-building argument is
 * applied to the WHOLE query ignoring pagination-carried strategies —
 * root AND child/field paginations. A warning/info log highlights that the
 * request asked for a strategy but backend code forces a different one.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { setGlobalConfig } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Author, Book } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('explicit orStrategy argument overrides child pagination orStrategy', () => {
	let mapper: GQLtoSQLMapper;

	beforeEach(() => {
		mapper = new GQLtoSQLMapper(createMockMetadataProvider());
	});

	afterEach(() => {
		setGlobalConfig({ orStrategy: 'union-all' });
		process.env.D3GOP_LOG_TYPE = 'disabled';
	});

	const authorWithBooks = (childPagination: any, extra: any = {}) =>
		mapper.buildQueryAndBindingsFor({
			fields: {
				id: {},
				name: {},
				books: {
					fieldsByTypeName: {},
					args: {
						// relation key holding _or → child-branch EXISTS whose shape
						// (union all vs flattened or) reveals the applied strategy
						filter: { author: { _or: [{ name_eq: 'A' }, { name_eq: 'B' }] } },
						pagination: childPagination,
					},
				},
			},
			entity: Author,
			customFields: {},
			...extra,
		});

	describe('explicit argument wins over child pagination', () => {
		it('explicit "union-all" beats child pagination.orStrategy "or"', () => {
			const { querySQL } = authorWithBooks({ orStrategy: 'or' }, { orStrategy: 'union-all' });

			// the whole query — including the child branch — stays UNION ALL
			expect(querySQL.toLowerCase()).toContain('union all');
		});

		it('explicit "or" beats child pagination.orStrategy "union-all"', () => {
			const { querySQL } = authorWithBooks({ orStrategy: 'union-all' }, { orStrategy: 'or' });

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL).toContain(') or (');
		});

		it('explicit "union-all" beats child "or" even when root pagination also says "or"', () => {
			const { querySQL } = authorWithBooks(
				{ orStrategy: 'or' },
				{ pagination: { orStrategy: 'or' }, orStrategy: 'union-all' }
			);

			expect(querySQL.toLowerCase()).toContain('union all');
		});
	});

	describe('override warning for child paginations', () => {
		const spyWarn = () => {
			const warnSpy = mock(() => {});
			const origWarn = console.warn;
			console.warn = warnSpy as any;
			process.env.D3GOP_LOG_TYPE = 'orStrategy';
			return () => {
				console.warn = origWarn;
				process.env.D3GOP_LOG_TYPE = 'disabled';
				return warnSpy;
			};
		};

		it('warns when a child pagination.orStrategy is overridden by the explicit argument', () => {
			const restore = spyWarn();
			try {
				authorWithBooks({ orStrategy: 'or' }, { orStrategy: 'union-all' });
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).toHaveBeenCalledTimes(1);
			const msg = warnSpy.mock.calls[0].join(' ');
			expect(msg).toContain('orStrategy');
			// highlights both the requested child strategy and the forced one
			expect(msg).toContain('"or"');
			expect(msg).toContain('"union-all"');
		});

		it('does NOT warn when the child pagination strategy agrees with the explicit argument', () => {
			const restore = spyWarn();
			try {
				authorWithBooks({ orStrategy: 'union-all' }, { orStrategy: 'union-all' });
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('warns once per overridden child, not per nested subquery', () => {
			const restore = spyWarn();
			try {
				mapper.buildQueryAndBindingsFor({
					fields: {
						id: {},
						title: {},
						// two siblings, both overridden
						characters: {
							fieldsByTypeName: {},
							args: {
								filter: { ring: { _or: [{ name_eq: 'Narya' }, { name_eq: 'Nenya' }] } },
								pagination: { orStrategy: 'or' },
							},
						},
						genres: {
							fieldsByTypeName: {},
							args: {
								filter: { books: { _or: [{ title_eq: 'A' }, { title_eq: 'B' }] } },
								pagination: { orStrategy: 'or' },
							},
						},
					},
					entity: Book,
					customFields: {},
					orStrategy: 'union-all',
				} as any);
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).toHaveBeenCalledTimes(2);
		});
	});
});
