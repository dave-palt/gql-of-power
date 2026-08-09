import { describe, expect, it } from 'bun:test';
import { printSchema } from 'graphql';
import 'reflect-metadata';
import { Arg, buildSchema, Query, Resolver } from 'type-graphql';

import { setGlobalConfig } from '../../src';
import { createGQLTypes } from '../../src/entities/gql-entity';
import { Author, Book, Genre } from '../fixtures/middle-earth-schema';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

/**
 * Helper: build a real type-graphql schema and print it as SDL.
 * The FilterInput is referenced via a query @Arg so type-graphql keeps it in the schema.
 */
async function buildSDL(resolvers: Function[]): Promise<string> {
	const schema = await buildSchema({ resolvers, validate: false });
	return printSchema(schema);
}

/**
 * Extract the type of a field from a FilterInput definition in SDL.
 * Returns the full `input XxxFilterInput { ... }` block (first match).
 */
function extractInputBlock(sdl: string, inputName: string): string {
	const re = new RegExp(`input ${inputName} \\{[\\s\\S]*?\\n\\}`);
	const m = sdl.match(re);
	return m ? m[0] : '';
}

describe('custom-field filter type resolution (schema-level)', () => {
	describe('relationship fields (relatedEntityName)', () => {
		it('Author.books filter resolves to BookFilterInput, not AuthorFilterInput', async () => {
			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				title: { type: () => String, options: { nullable: true }, generateFilter: true },
			});

			const AuthorGQL = createGQLTypes(Author, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				name: { type: () => String, options: { nullable: true }, generateFilter: true },
				books: {
					type: () => BookGQL.GQLEntity,
					options: { nullable: true },
					generateFilter: true,
					array: true,
					relatedEntityName: () => Book.name,
				},
			});

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				authors(
					@Arg('filter', () => AuthorGQL.GQLEntityFilterInput, { nullable: true }) _filter?: any
				) {
					return [];
				}
			}

			const sdl = await buildSDL([AuthorResolver, AuthorGQL.FieldsResolver as any]);
			const block = extractInputBlock(sdl, 'AuthorFilterInput');

			// The PascalCased field name "Books" should reference BookFilterInput
			expect(block).toContain('Books: BookFilterInput');
			// Must NOT be AuthorFilterInput (the bug: root type instead of field type)
			expect(block).not.toContain('Books: AuthorFilterInput');
		});

		it('Book.author (m:1 singular relation) filter resolves to AuthorFilterInput, not BookFilterInput', async () => {
			const AuthorGQL = createGQLTypes(Author, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				name: { type: () => String, options: { nullable: true }, generateFilter: true },
			});

			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				title: { type: () => String, options: { nullable: true }, generateFilter: true },
				author: {
					type: () => AuthorGQL.GQLEntity,
					options: { nullable: true },
					generateFilter: true,
					relatedEntityName: () => Author.name,
				},
			});

			@Resolver(() => BookGQL.GQLEntity)
			class BookResolver {
				@Query(() => [BookGQL.GQLEntity])
				books(
					@Arg('filter', () => BookGQL.GQLEntityFilterInput, { nullable: true }) _filter?: any
				) {
					return [];
				}
			}

			const sdl = await buildSDL([BookResolver, BookGQL.FieldsResolver as any]);
			const block = extractInputBlock(sdl, 'BookFilterInput');

			expect(block).toContain('Author: AuthorFilterInput');
			expect(block).not.toContain('Author: BookFilterInput');
		});
	});

	describe('mapping custom fields (mapping.refEntity)', () => {
		it('Author.books filter (mapping strategy) resolves to BookFilterInput', async () => {
			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				title: { type: () => String, options: { nullable: true }, generateFilter: true },
			});

			const AuthorGQL = createGQLTypes(
				Author,
				{
					id: { type: () => Number, options: { nullable: false }, generateFilter: true },
					name: { type: () => String, options: { nullable: true }, generateFilter: true },
				},
				{
					customFields: {
						favoriteBook: {
							type: () => BookGQL.GQLEntity,
							options: { nullable: true },
							generateFilter: true,
							mapping: {
								refEntity: Book,
								refFields: 'id',
								fields: 'id',
							},
						},
					} as any,
				}
			);

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				authors(
					@Arg('filter', () => AuthorGQL.GQLEntityFilterInput, { nullable: true }) _filter?: any
				) {
					return [];
				}
			}

			const sdl = await buildSDL([AuthorResolver, AuthorGQL.FieldsResolver as any]);
			const block = extractInputBlock(sdl, 'AuthorFilterInput');

			// Mapping custom field generates a PascalCased field "FavoriteBook" typed as BookFilterInput
			expect(block).toContain('FavoriteBook: BookFilterInput');
			expect(block).not.toContain('FavoriteBook: AuthorFilterInput');
		});
	});

	describe('_exists filter', () => {
		it('AuthorExistsFilterInput.books resolves to BookFilterInput', async () => {
			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				title: { type: () => String, options: { nullable: true }, generateFilter: true },
			});

			const AuthorGQL = createGQLTypes(Author, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				name: { type: () => String, options: { nullable: true }, generateFilter: true },
				books: {
					type: () => BookGQL.GQLEntity,
					options: { nullable: true },
					generateFilter: true,
					array: true,
					relatedEntityName: () => Book.name,
				},
			});

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				authors(
					@Arg('filter', () => AuthorGQL.GQLEntityFilterInput, { nullable: true }) _filter?: any
				) {
					return [];
				}
			}

			const sdl = await buildSDL([AuthorResolver, AuthorGQL.FieldsResolver as any]);
			const existsBlock = extractInputBlock(sdl, 'AuthorExistsFilterInput');

			expect(existsBlock).toContain('books: BookFilterInput');
			expect(existsBlock).not.toContain('books: AuthorFilterInput');
		});
	});
});
