# gql-of-power

A powerful library to generate GraphQL queries mapping based on MikroORM entities.

## Features

- Automatic GraphQL schema generation from MikroORM entities
- Advanced filtering capabilities
- Pagination support
- Custom field resolvers
- Relationship handling

## Installation

```bash
# Using npm
npm install @dav3/gql-of-power

# Using yarn
yarn add @dav3/gql-of-power

# Using pnpm
pnpm add @dav3/gql-of-power
```

## Quick Start

```typescript
import { initialize } from "@dav3/gql-of-power";
import { MikroORM } from "@mikro-orm/core";

// Initialize MikroORM
const orm = await MikroORM.init({
  // Your MikroORM configuration
});

// Initialize gql-of-power
initialize({
  entityManager: orm.em,
  logLevel: LogLevel.INFO,
});

// Now you can use the library to create GraphQL entities and resolvers
```

## Usage Example

```typescript
import { createGQLEntity } from "@dav3/gql-of-power";
import { User } from "./entities/User";

// Create GraphQL entity based on MikroORM entity
const { GQLEntity, GQLEntityFilterInput } = createGQLEntity(
  User,
  {
    id: {
      type: () => ID,
      generateFilter: true,
    },
    username: {
      type: () => String,
      generateFilter: true,
    },
    email: {
      type: () => String,
      generateFilter: true,
    },
  },
  {
    fullName: {
      type: () => String,
      requires: ["firstName", "lastName"],
      resolve: (user) => `${user.firstName} ${user.lastName}`,
    },
  }
);
```

## Documentation

For complete documentation and examples, see our [Documentation](https://github.com/yourusername/gql-of-power/docs).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT NON-AI License - see the LICENSE file for details.
