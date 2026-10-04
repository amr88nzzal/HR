import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export type TestPg = {
  /** اتصال المالك (يتجاوز RLS) */
  adminUrl: string;
  /** اتصال دور hrms_app (خاضع لـ RLS) */
  appUrl: string;
  stop: () => Promise<void>;
};

const APP_PASSWORD = 'test-app-password';

const withUser = (url: string, user: string, password: string): string => {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
};

/**
 * يجهّز قاعدة اختبار مرحَّلة بالكامل.
 * - إن وُجد TEST_PG_ADMIN_URL (خادم محلي بصلاحيات superuser) تُنشأ قاعدة جديدة عليه،
 *   ويُضاف بديل uuidv7() إن كان الإصدار أقدم من 18.
 * - وإلا تُشغَّل حاوية postgres:18 (يتطلب Docker، كما في CI).
 */
export const startTestPg = async (): Promise<TestPg> => {
  const external = process.env['TEST_PG_ADMIN_URL'];
  let adminUrl: string;
  let stop: () => Promise<void>;

  if (external) {
    const name = `hrms_test_${randomBytes(4).toString('hex')}`;
    const root = new pg.Client({ connectionString: external });
    await root.connect();
    await root.query(`create database ${name}`);
    await root.end();
    const u = new URL(external);
    u.pathname = `/${name}`;
    adminUrl = u.toString();
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    const { rows } = await c.query<{ v: number }>(
      `select current_setting('server_version_num')::int as v`,
    );
    if ((rows[0]?.v ?? 0) < 180000) {
      await c.query('create extension if not exists pgcrypto');
      await c.query(`create function uuidv7() returns uuid language sql as $$
        select encode(overlay(overlay(gen_random_bytes(16) placing substring(int8send((extract(epoch from clock_timestamp())*1000)::bigint) from 3) from 1 for 6) placing '\\x70'::bytea from 7 for 1),'hex')::uuid $$`);
    }
    await c.end();
    stop = async () => {
      const r = new pg.Client({ connectionString: external });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    };
  } else {
    const container = await new PostgreSqlContainer('postgres:18').start();
    adminUrl = container.getConnectionUri();
    stop = async () => {
      await container.stop();
    };
  }

  execFileSync('pnpm', ['migrate', 'up'], {
    env: { ...process.env, DATABASE_URL: adminUrl },
    stdio: 'ignore',
  });
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`alter role hrms_app login password '${APP_PASSWORD}'`);
  await admin.end();

  return { adminUrl, appUrl: withUser(adminUrl, 'hrms_app', APP_PASSWORD), stop };
};
