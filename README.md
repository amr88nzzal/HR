# HRMS — نظام إدارة شؤون الموظفين

مونوريبو (pnpm): `apps/api` (Express 5 + TypeScript)، `apps/web` (Vite + React)، `packages/shared` (أنواع ومخططات Zod مشتركة)، `infra/` (Docker وNginx).

- **التصميم والمعايير والخطة:** `docs/DESIGN.md` · `docs/CONVENTIONS.md` · `docs/PLAN.md` (تُحدَّث عند انتهاء كل مرحلة).
- **النموذج الأولي القديم:** `reference/prototype/` (للرجوع فقط؛ لا يُشغَّل ولا يُبنى عليه).

## التطوير

```bash
corepack enable
pnpm install
cp .env.example .env        # عدّل القيم
pnpm dev:api                 # http://localhost:3000/health/live
pnpm dev:web                 # http://localhost:5173
pnpm typecheck && pnpm lint && pnpm test
```

## التشغيل بـ Docker

```bash
cp .env.example .env         # عدّل: POSTGRES_PASSWORD و APP_DB_PASSWORD و JWT_SECRET ومفاتيح التشفير (ENCRYPTION_*)
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

مفاتيح التشفير (مرة واحدة، واحفظ نسخة منها خارج الخادم):

```bash
echo "ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)"
echo "ENCRYPTION_KEY_ID=k1"
echo "ENCRYPTION_DIGEST_KEY=$(openssl rand -base64 32)"
```

الملفات المرفوعة (الأرشيف وصور الموظفين) تُحفظ في volume باسم `filesdata` (`/data/files` داخل الحاوية). انسخه احتياطياً مع قاعدة البيانات، وتحتاج الملفات المشفّرة المفاتيح نفسها أعلاه.

أنشئ أول مدير (مرة واحدة؛ كلمة المرور تُمرَّر بمتغير بيئة لا بسطر الأوامر):

```bash
docker compose -f infra/docker-compose.yml --env-file .env run --rm \
  -e ADMIN_PASSWORD='كلمة-مرور-طويلة-وغير-شائعة' migrate \
  node dist/cli.js create-admin --email admin@example.com --name "المدير" --company-name "اسم الشركة"
```

أوامر أخرى: `post-migrate` (تلقائي عند كل نشر)، `reset-password --email ...`.
التطبيق يتصل بدور `hrms_app` (غير مالك) فتُطبَّق سياسات RLS؛ المالك للترحيل والـ CLI فقط.

> **تنبيه:** صورة PostgreSQL تقرأ `POSTGRES_USER` و`POSTGRES_PASSWORD` عند إنشاء الـ volume أول مرة فقط. إن غيّرتهما لاحقاً فنفّذ `docker compose ... down -v` (يمسح بيانات القاعدة!) أو غيّرهما داخل PostgreSQL نفسه.

## التهجيرات

ملفات SQL في `apps/api/migrations` (قسما `-- Up Migration` و`-- Down Migration`):

```bash
pnpm --filter @hrms/api migrate:create اسم_التهجير
DATABASE_URL=... pnpm --filter @hrms/api migrate up     # أو down
```

في Docker تعمل خدمة `migrate` تلقائياً قبل الـ API. اختبار التكامل (يتطلب Docker): `pnpm --filter @hrms/api test:integration`.

### البريد الإلكتروني (اختياري)

يرسل العامل (`worker`) إشعارات البريد. أضف إلى `.env` على السيرفر (لا تضعها في Git):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<كلمة مرور التطبيق>
EMAIL_FROM=you@gmail.com
```

بدلاً منها يمكن `SMTP_URL=smtp://user:pass@host:587`. مع Gmail يلزم **كلمة مرور تطبيق** (App password) لا كلمة مرور الحساب. بدون هذه المتغيرات تُعلَّم رسائل البريد `skipped` ويستمر النظام. بعد التعديل: `docker compose -f infra/docker-compose.yml --env-file .env up -d worker`.
