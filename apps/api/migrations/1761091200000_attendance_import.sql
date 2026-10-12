-- Up Migration
-- الحضور 5c: مركز استيراد البصمات (ملفات الاستيراد، الدفعات، السجلات المحجوزة لـ HR).

create table import_profiles (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  name_ar text not null,
  name_en text,
  delimiter text not null default ';' check (delimiter in (';', ',', E'\t', '|')),
  encoding text not null default 'auto' check (encoding in ('auto', 'utf-8', 'windows-1256')),
  has_header text not null default 'auto' check (has_header in ('auto', 'yes', 'no')),
  -- ربط الأعمدة: فهرس (يبدأ من 0) أو اسم عمود الترويسة؛ null = غير موجود
  columns jsonb not null default '{"branch":0,"department":1,"employee":2,"datetime":3,"type":4}'::jsonb,
  date_order text not null default 'auto' check (date_order in ('auto', 'ymd', 'dmy', 'mdy')),
  -- type: الثقة بعمود النوع، أو تجاهله والاشتقاق من الترتيب
  direction_mode text not null default 'type' check (direction_mode in ('type', 'ignore')),
  in_values text[] not null default array['0', 'in', 'i'],
  out_values text[] not null default array['1', 'out', 'o'],
  system_key text not null default 'attendance_device',
  is_default boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create unique index import_profiles_default_idx on import_profiles (company_id) where is_default;

create table import_batches (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  profile_id uuid references import_profiles (id) on delete set null,
  file_name text,
  file_hash text not null,
  status text not null default 'applied' check (status in ('applied', 'reverted')),
  total_rows integer not null default 0,
  inserted integer not null default 0,
  duplicates integer not null default 0,
  held integer not null default 0,
  errors integer not null default 0,
  employees integer not null default 0,
  date_from date,
  date_to date,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by uuid references users (id)
);
-- نفس الملف لا يُطبَّق مرتين (إلا بعد التراجع عنه)
create unique index import_batches_hash_idx on import_batches (company_id, file_hash) where status = 'applied';
create index import_batches_created_idx on import_batches (company_id, created_at desc);

alter table attendance_records add column batch_id uuid references import_batches (id);
create index attendance_records_batch_idx on attendance_records (batch_id) where batch_id is not null;

-- سجلات لم تُطابَق (رمز جهاز غير مربوط أو ملتبس): تُحجز حتى يقرر HR
create table import_held_rows (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  batch_id uuid not null references import_batches (id) on delete cascade,
  line_no integer not null,
  device_code text not null,
  device_branch text,
  device_department text,
  punched_at timestamptz not null,
  direction text check (direction in ('in', 'out')),
  reason text not null check (reason in ('unmatched', 'ambiguous')),
  status text not null default 'held' check (status in ('held', 'resolved', 'discarded')),
  employee_id uuid references employees (id),
  resolved_by uuid references users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_held_rows_status_idx on import_held_rows (company_id, status, device_code);
create index import_held_rows_batch_idx on import_held_rows (batch_id);

do $$
declare t text;
begin
  foreach t in array array['import_profiles', 'import_batches', 'import_held_rows']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  create trigger import_profiles_updated_at before update on import_profiles
    for each row execute function set_updated_at();
  create trigger import_profiles_audit after insert or update or delete on import_profiles
    for each row execute function audit_row_change('version', 'updated_at');
  create trigger import_batches_audit after insert or update or delete on import_batches
    for each row execute function audit_row_change('version', 'updated_at');
end $$;

-- Down Migration
alter table attendance_records drop column batch_id;
drop table import_held_rows, import_batches, import_profiles;
