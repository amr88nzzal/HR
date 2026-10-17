# دليل التشغيل والإطلاق

> ما لا يمكن إنجازه من الكود (UAT ببيانات حقيقية، ترحيل البيانات، إعداد السيرفر وCloudflare) موثّق هنا كقوائم تنفيذ.

## 1. النشر والتحديث

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file .env up -d --build   # يشمل api وworker وgateway وmigrate
curl -fsS https://hr.amrodev.com/health/ready
```

- `/health/live`: العملية تعمل. `/health/ready`: قاعدة البيانات + التخزين (حرجان: 503 عند الفشل) + `render` و`worker` (غير حرجين: 200 بحالة `degraded`).
- `worker` يعتبر متعطلاً إن بقيت مهام `created` أقدم من 10 دقائق.

### التراجع
1. خذ نسخة احتياطية قبل كل ترقية (`backup.sh` أدناه).
2. تراجع عن الكود: `git checkout <الإصدار السابق>` ثم أعد البناء.
3. إن كانت هناك تهجيرات جديدة: `migrate down` بعدد التهجيرات المضافة (كل تهجير فيه قسم Down)، وإن تعذّر فاستعد النسخة.

## 2. النسخ الاحتياطي والاستعادة

خدمة `backup` (profile اختياري) تنفّذ يومياً عند `BACKUP_HOUR_UTC`: `pg_dump -Fc` + أرشيف الملفات، مشفّرة AES-256 (`BACKUP_PASSPHRASE_FILE`) مع بصمة SHA-256، وتدوير 7 يومي/4 أسبوعي/6 شهري، ورفع اختياري خارج السيرفر عبر `rclone` إلى `BACKUP_REMOTE`. كل أحد تُجري **استعادة تحقق** إلى قاعدة مؤقتة وتفحص: عدد الجداول، سجلات التهجير، وجود شركات، عدم وجود مستخدمين يتامى.

الإعداد لمرة واحدة:
```bash
sudo install -d -m 700 /etc/hrms/rclone
openssl rand -base64 48 | sudo tee /etc/hrms/backup.passphrase >/dev/null && sudo chmod 600 /etc/hrms/backup.passphrase
# ضع rclone.conf في /etc/hrms/rclone ثم عيّن BACKUP_REMOTE في .env
docker compose -f infra/docker-compose.yml --env-file .env --profile backup up -d --build backup
```
**احفظ نسخة من العبارة السرية خارج السيرفر** (بدونها لا استعادة).

الحالة: `status-backup.json` و`status-restore.json` في volume `backups`:
```bash
docker compose -f infra/docker-compose.yml exec backup cat /backups/status-backup.json /backups/status-restore.json
```
استعادة يدوية للتحقق: `/opt/backup/restore-verify.sh` (رموز الخروج: 3 بصمة خاطئة، 4 عبارة خاطئة، 5–9 فشل فحص).

**قيد:** أرشفة WAL (استعادة لحظية PITR) غير منفّذة؛ النسخ منطقي يومي (RPO حتى 24 ساعة). للتحسين لاحقاً: pgBackRest أو wal-g مع الوجهة نفسها.

## 3. المراقبة وGlitchTip
- شغّل GlitchTip (أو Sentry) واحصل على DSN، ثم `SENTRY_DSN` و`APP_RELEASE` في `.env` لـ api وworker وأعد التشغيل.
- يُرسَل فقط: الاستثناء، `requestId`، والمسار بلا query. **لا** body ولا headers ولا مستخدم.
- راقب `/health/ready` بمراقب خارجي (UptimeRobot أو Cloudflare Health Checks) مع تنبيه عند 503 أو `degraded` > 10 دقائق.
- اربط تنبيه فشل `status-backup.json` (أقدم من 26 ساعة) بفحص دوري.

## 4. الأمان
- الترويسات في `infra/nginx/security-headers.conf` (HSTS وCSP صارمة وframe-ancestors none…). تحقق CSP محلياً مقابل بناء الواجهة: لا مخالفات في صفحة الدخول. **راجع الواجهة الحية بعد النشر** (أيقونات/خطوط خارجية ستُحجب).
- Cloudflare: Access أمام التطبيق (أو على `/api/v1/admin`)، قواعد WAF وRate Limit على `/api/v1/auth/*`، وSSL Full (strict).
- `security.integration.test.ts` يعدّ كل المسارات (>250) ويفحص: 401 بلا توكن، منع المستخدم بلا صلاحيات، عدم وجود 5xx، وعزل الشركات. أي مسار جديد يتطلب صلاحية أو إدراجاً صريحاً في `AUTH_ONLY` مع تعليل، وإلا فشل الاختبار.

## 5. الأداء
`perf.integration.test.ts` يولّد بيانات اصطناعية كبيرة ويقيس خطوات (قوائم، تقارير، تصدير، احتساب رواتب) بميزانيات زمنية. التصدير الكبير يستخدم مؤشراً من جهة الخادم (أسرع نحو 14× لـ CSV). شغّله قبل الإطلاق وبعد أي تغيير كبير في الاستعلامات.

## 6. ترحيل البيانات
1. جهّز ملف الموظفين على قالب `/employee-import` وراجع تقرير التحقق (dry-run) حتى يصبح خالياً من الأخطاء.
2. استورد، ثم رصيد الإجازات الافتتاحي، ثم الرواتب (هياكل ومكونات وراتب كل موظف)، ثم السلف القائمة.
3. استورد سجل الحضور التاريخي عبر استيراد الحضور إن لزم.
4. قارن أعداد الموظفين والأرصدة مع المصدر ووقّع HR.

## 7. قائمة قبول المستخدم (UAT)
- [ ] تسجيل دخول كل دور (نظام، موارد، مدير، موظف) ومطابقة الصلاحيات والنطاق.
- [ ] دورة إجازة كاملة: طلب ← موافقة ← رصيد ← إشعار.
- [ ] الحضور: استيراد ملف حقيقي وتصحيحات وموافقتها.
- [ ] **دورة رواتب موازية** لعملية الشركة الحالية لشهر كامل: مطابقة الصافي لكل موظف (فروق مبررة ومسجلة).
- [ ] قفل الدورة، ونشر القسائم، وتنزيل PDF، ومقارنة الشهر السابق.
- [ ] تقارير وتصدير (CSV/Excel/PDF) وحجب الأعمدة الحساسة.
- [ ] نسخة احتياطية + استعادة تحقق ناجحة موثقة بتاريخها.
- [ ] تدريب HR والمدراء، وتوقيع القبول (الاسم، التاريخ).
