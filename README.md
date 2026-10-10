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

### بيانات تجريبية (للتجربة والعرض فقط)

بعد `create-admin` يمكن بذر شركة ببيانات تجريبية تغطي كل ما نُفّذ حتى الآن:

- **الأساس:** فرعان وخمسة أقسام ودرجات ومسميات ومراكز تكلفة و30 موظفاً (`DEMO-001`…) بسلاسل مديرين وتعيينات وعقود وجهات اتصال وأكواد محاسبة/بصمة، وثلاثة مستخدمين (`demo.hr@demo.hrms.local` مدير موارد بشرية، `demo.manager@…` مدير مباشر، `demo.employee@…` موظف).
- **تفاصيل الموظفين:** عناوين وجهات طوارئ ومعالون وتعليم وخبرات وحسابات بنكية (مشفّرة) وحقول إضافية بينها حقل حساس (الرقم الوطني)، وعملة أساسية JOD.
- **أحداث وظيفية:** نقل وترقية وتغيير مدير وإيقاف وإعادة تفعيل وإنهاء خدمة.
- **الأرشيف:** أنواع وثائق (هوية/إقامة للموظفين، رخصة المنشأة، عقد إيجار الفرع) و17 وثيقة بتذكيرات متأخرة وقريبة وبعيدة (تغذّي الملخص اليومي).
- **الموافقات:** سلسلة عامة بخطوتين (الثانية مشروطة بالمبلغ ≥ 1000) وتفويض، وسبعة طلبات بكل الحالات (معلّق، موافَق، مرفوض، مُرجَع، مسحوب) مع إشعاراتها، ومستخدم إضافي `demo.ceo@…` للمدير العام.

كلمة مرور المستخدمين من `DEMO_PASSWORD`. الأمر آمن لإعادة التشغيل **ويُحدّث قاعدة بُذرت سابقاً**: كل طبقة لها علامة فتُضاف الناقصة فقط دون حذف أو تعديل ما هو موجود. حسابات البنك والحقل الحساس تحتاج مفاتيح `ENCRYPTION_*` (تمرّرها compose لخدمة `migrate` من `.env` تلقائياً).

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env run --rm \
  -e DEMO_PASSWORD='كلمة-مرور-تجريبية-طويلة' migrate \
  node dist/cli.js seed-demo --company main
```

لا تشغّله على قاعدة إنتاج حقيقية؛ لإزالتها احذف الـ volume وأعد التهيئة (`down -v`) أو احذف سجلات `DEMO-` يدوياً.
التطبيق يتصل بدور `hrms_app` (غير مالك) فتُطبَّق سياسات RLS؛ المالك للترحيل والـ CLI فقط.

> **تنبيه:** صورة PostgreSQL تقرأ `POSTGRES_USER` و`POSTGRES_PASSWORD` عند إنشاء الـ volume أول مرة فقط. إن غيّرتهما لاحقاً فنفّذ `docker compose ... down -v` (يمسح بيانات القاعدة!) أو غيّرهما داخل PostgreSQL نفسه.

## التهجيرات

ملفات SQL في `apps/api/migrations` (قسما `-- Up Migration` و`-- Down Migration`):

```bash
pnpm --filter @hrms/api migrate:create اسم_التهجير
DATABASE_URL=... pnpm --filter @hrms/api migrate up     # أو down
```

في Docker تعمل خدمة `migrate` تلقائياً قبل الـ API. اختبار التكامل (يتطلب Docker): `pnpm --filter @hrms/api test:integration`.
