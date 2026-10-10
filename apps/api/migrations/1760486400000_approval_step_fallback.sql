-- Up Migration
-- معتمد بديل للخطوة: دور يُستعمل إن تعذّر تحديد المعتمد الأصلي (مثلاً لا مدير مباشر).
alter table approval_steps add column fallback_role_id uuid references roles (id) on delete set null;

-- Down Migration
alter table approval_steps drop column fallback_role_id;
