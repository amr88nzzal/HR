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
cp .env.example .env         # ضع كلمة مرور قوية لـ POSTGRES_PASSWORD
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

> **تنبيه:** صورة PostgreSQL تقرأ `POSTGRES_USER` و`POSTGRES_PASSWORD` عند إنشاء الـ volume أول مرة فقط. إن غيّرتهما لاحقاً فنفّذ `docker compose ... down -v` (يمسح بيانات القاعدة!) أو غيّرهما داخل PostgreSQL نفسه.

## التهجيرات

ملفات SQL في `apps/api/migrations` (قسما `-- Up Migration` و`-- Down Migration`):

```bash
pnpm --filter @hrms/api migrate:create اسم_التهجير
DATABASE_URL=... pnpm --filter @hrms/api migrate up     # أو down
```

في Docker تعمل خدمة `migrate` تلقائياً قبل الـ API. اختبار التكامل (يتطلب Docker): `pnpm --filter @hrms/api test:integration`.
