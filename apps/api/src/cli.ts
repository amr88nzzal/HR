import { sql } from 'kysely';
import { installJobSchema } from './jobs/install.js';
import { createDb } from './db/index.js';
import { withTenant } from './db/tenant.js';
import {
  checkPasswordPolicy,
  hashPassword,
  seedDefaultRoles,
  syncPermissionCatalog,
} from './modules/identity/index.js';
import { seedDefaultExternalSystems } from './modules/employees/external.routes.js';
import { seedDemo } from './seed/demo.js';
import { seedDemoExtras } from './seed/demo-extras.js';
import { createFieldCrypto } from './shared/crypto.js';

/**
 * أوامر الإدارة (تعمل بحساب المالك DATABASE_ADMIN_URL لأنها تتجاوز RLS):
 *   post-migrate     يضبط كلمة مرور hrms_app ويزامن كتالوج الصلاحيات ويمنح admin الجديد منها (آمن لإعادة التشغيل)
 *   create-admin     ينشئ الشركة (إن لزم) وأدوارها الافتراضية ومستخدماً بدور admin
 *   reset-password   يعيد تعيين كلمة مرور مستخدم
 *   seed-demo        يبذر بيانات تجريبية شاملة (هيكل، 30 موظفاً، تفاصيل، أحداث وظيفية، أرشيف، موافقات) ويضيف الطبقات الناقصة؛ آمن لإعادة التشغيل
 * كلمات المرور تُمرَّر عبر متغير البيئة ADMIN_PASSWORD لا عبر سطر الأوامر.
 */
const args = (argv: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a?.startsWith('--')) out[a.slice(2)] = argv[i + 1] ?? '';
  }
  return out;
};

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`المعامل ${name} مطلوب`);
  return value;
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  const url = need(process.env['DATABASE_ADMIN_URL'], 'DATABASE_ADMIN_URL');
  const db = createDb(url);
  try {
    if (command === 'post-migrate') {
      const pw = need(process.env['APP_DB_PASSWORD'], 'APP_DB_PASSWORD');
      // ALTER ROLE لا يقبل معاملات ربط؛ نمرّر القيمة عبر set_config داخل معاملة واحدة ونقتبسها بـ format(%L)
      await db.transaction().execute(async (trx) => {
        await sql`select set_config('hrms.pw', ${pw}, true)`.execute(trx);
        await sql`do $$ begin execute format('alter role hrms_app login password %L', current_setting('hrms.pw')); end $$`.execute(
          trx,
        );
      });
      await db.transaction().execute((trx) => syncPermissionCatalog(trx));
      await installJobSchema(url);
      // إعادة منح دور admin كل الصلاحيات الجديدة في كل شركة (بقية الأدوار لا تُمسّ)
      const companies = await db.selectFrom('companies').select('id').execute();
      for (const c of companies) {
        await withTenant(db, { companyId: c.id, requestId: 'cli' }, (ctx) => seedDefaultRoles(ctx));
      }
      console.log('post-migrate: تم ضبط hrms_app ومزامنة الصلاحيات وأدوار admin');
    } else if (command === 'create-admin') {
      const slug = opts['company'] ?? 'main';
      const email = need(opts['email'], '--email').toLowerCase();
      const password = need(process.env['ADMIN_PASSWORD'], 'ADMIN_PASSWORD');
      const problem = checkPasswordPolicy(password, { email });
      if (problem) throw new Error(problem);

      await db.transaction().execute((trx) => syncPermissionCatalog(trx));
      const companyId = await db.transaction().execute(async (trx) => {
        const found = await trx
          .selectFrom('companies')
          .select('id')
          .where('slug', '=', slug)
          .executeTakeFirst();
        if (found) return found.id;
        const row = await trx
          .insertInto('companies')
          .values({ slug, nameAr: opts['company-name'] ?? 'الشركة' })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });
      await withTenant(db, { companyId, requestId: 'cli' }, async (ctx) => {
        await seedDefaultRoles(ctx);
        await seedDefaultExternalSystems(ctx);
        const role = await ctx.trx
          .selectFrom('roles')
          .select('id')
          .where('companyId', '=', companyId)
          .where('code', '=', 'admin')
          .executeTakeFirstOrThrow();
        const user = await ctx.trx
          .insertInto('users')
          .values({
            companyId,
            email,
            username: opts['username'] ?? null,
            displayName: opts['name'] ?? email,
            passwordHash: await hashPassword(password),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.trx
          .insertInto('userRoleAssignments')
          .values({
            companyId,
            userId: user.id,
            roleId: role.id,
            scopeType: 'company',
            scopeId: null,
          })
          .execute();
      });
      console.log(`create-admin: تم إنشاء ${email} في الشركة ${slug}`);
    } else if (command === 'reset-password') {
      const email = need(opts['email'], '--email').toLowerCase();
      const password = need(process.env['ADMIN_PASSWORD'], 'ADMIN_PASSWORD');
      const problem = checkPasswordPolicy(password, { email });
      if (problem) throw new Error(problem);
      const res = await db
        .updateTable('users')
        .set({
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
        })
        .where('email', '=', email)
        .where(
          'companyId',
          'in',
          db
            .selectFrom('companies')
            .select('id')
            .where('slug', '=', opts['company'] ?? 'main'),
        )
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw new Error('المستخدم غير موجود');
      console.log(`reset-password: تم تحديث ${email}`);
    } else if (command === 'seed-demo') {
      const slug = opts['company'] ?? 'main';
      const password = need(process.env['DEMO_PASSWORD'], 'DEMO_PASSWORD');
      const problem = checkPasswordPolicy(password, { email: 'demo.hr@demo.hrms.local' });
      if (problem) throw new Error(problem);
      const company = await db
        .selectFrom('companies')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirst();
      if (!company) throw new Error(`الشركة ${slug} غير موجودة؛ أنشئها أولاً بـ create-admin`);
      const result = await withTenant(db, { companyId: company.id, requestId: 'cli' }, (ctx) =>
        seedDemo(ctx, password),
      );
      if (result.skipped)
        console.log('seed-demo: الأساس (الهيكل والموظفون والمستخدمون) موجود مسبقاً');
      else {
        console.log(`seed-demo: أُنشئ ${result.employees} موظفاً وهيكل تنظيمي كامل`);
        for (const u of result.users) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
      }
      // تشفير الحقول (حسابات بنكية وحقول حساسة) يلزم مفاتيح الخادم نفسها
      const keys = process.env['ENCRYPTION_KEYS'];
      const keyId = process.env['ENCRYPTION_KEY_ID'];
      const digest = process.env['ENCRYPTION_DIGEST_KEY'];
      const crypto =
        keys && keyId && digest
          ? createFieldCrypto({ keysSpec: keys, currentKeyId: keyId, digestKey: digest })
          : undefined;
      if (!crypto)
        console.log('  تنبيه: لا مفاتيح ENCRYPTION_*؛ ستُتخطى الحسابات البنكية والحقل الحساس');
      const extras = await seedDemoExtras(db, company.id, { crypto, password });
      for (const e of extras)
        console.log(
          `  [${e.status === 'done' ? 'تم' : 'تخطي'}] ${e.part}${e.note ? ` — ${e.note}` : ''}`,
        );
      console.log('  كلمة المرور: قيمة DEMO_PASSWORD (للتجربة فقط، احذف البيانات قبل الإنتاج)');
    } else {
      throw new Error(
        'الأمر غير معروف. المتاح: post-migrate | create-admin | reset-password | seed-demo',
      );
    }
  } finally {
    await db.destroy();
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
