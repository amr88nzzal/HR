-- Up Migration
-- المرحلة 8: سجل التقارير وتخطيط الأعمدة

alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report'));

-- كل تشغيل لتقرير (معاينة لا تُسجَّل؛ التصدير يُسجَّل مباشراً أو كمهمة خلفية)
create table report_runs (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id),
  report_code text not null,
  format text not null check (format in ('csv', 'xlsx', 'html', 'pdf')),
  mode text not null check (mode in ('direct', 'job')),
  filters jsonb not null default '{}',
  columns jsonb not null default '[]',
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  row_count integer,
  file_id uuid references stored_files (id) on delete set null,
  error text,
  -- ينتهي رابط التنزيل ويُحذف الملف بعدها (مهمة التنظيف)
  expires_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index report_runs_user_idx on report_runs (company_id, user_id, created_at desc);
create index report_runs_expiry_idx on report_runs (expires_at) where file_id is not null;

-- تخطيط أعمدة محفوظ لكل مستخدم وتقرير؛ واحد فقط افتراضي
create table report_layouts (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  report_code text not null,
  name text not null check (length(name) between 1 and 80),
  columns jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, report_code, name)
);
create unique index report_layouts_default_uq on report_layouts (user_id, report_code) where is_default;

alter table report_runs enable row level security;
create policy tenant_isolation on report_runs
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
alter table report_layouts enable row level security;
create policy tenant_isolation on report_layouts
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table report_layouts, report_runs;
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand'));
