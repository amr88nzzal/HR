import { CamelCasePlugin, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

export type Db = Kysely<Database>;

/** اتصال Kysely: snake_case في القاعدة ↔ camelCase في الكود تلقائياً. */
export const createDb = (connectionString: string): Db =>
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    plugins: [new CamelCasePlugin()],
  });

export const pingDb = async (db: Db): Promise<void> => {
  await sql`select 1`.execute(db);
};
