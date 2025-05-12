import { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

export const hello = (name: string): string => {
  return `Hello, ${name}!`;
};

export let logger: {
  trace: (...messages: any[]) => void;
  error: (...messages: any[]) => void;
  info: (...messages: any[]) => void;
  debug: (...messages: any[]) => void;
  warn: (...messages: any[]) => void;
  fatal: (...messages: any[]) => void;
  log: (...messages: any[]) => void;
};

export let Database: {
  em: EntityManager<PostgreSqlDriver>;
};
