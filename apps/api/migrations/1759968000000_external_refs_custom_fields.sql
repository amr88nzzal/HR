-- Up Migration
-- المراجع الخارجية للموظف (رقم المحاسبة، كود جهاز البصمة…) والحقول المخصصة

create table external_systems (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  -- مفتاح ثابت يستخدمه الكود والاستيراد (مثل attendance_device, accounting)
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_ar text not null,
  name_en text,
  purpose text not null default 'other' check (purpose in ('accounting', 'attendance_device', 'other')),
  -- نطاق التفرّد: company = القيمة تخص الشركة كلها، branch = تتكرر بين الفروع (كود جهاز لكل فرع)
  ref_scope text not null default 'company' check (ref_scope in ('company', 'branch')),
  -- true: القيمة لا يحملها موظفان في الفترة نفسها (ضمن النطاق)
  is_unique boolean not null default true,
  -- تحقق اختياري من شكل القيمة (تعبير نمطي)
  validation_regex text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key),
  unique (company_id, id)
);

create table employee_external_refs (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  system_id uuid not null,
  -- القيمة نص كما أُدخلت بعد التطبيع (أصفار بادئة محفوظة)
  value text not null check (length(value) between 1 and 100),
  -- الفرع (لأنظمة ref_scope = branch فقط)
  branch_id uuid references branches (id),
  valid_from date,
  valid_to date,
  is_primary boolean not null default false,
  -- نسخة من خاصية النظام وقت الحفظ ليُفرض التفرّد بقيد قاعدة بيانات
  enforce_unique boolean not null default true,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, system_id) references external_systems (company_id, id),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  -- لا يحمل موظفان القيمة نفسها في فترات متداخلة (للأنظمة الفريدة)
  exclude using gist (
    system_id with =,
    value with =,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (enforce_unique),
  -- مرجع أساسي واحد للموظف في كل نظام/فرع في أي فترة
  exclude using gist (
    employee_id with =,
    system_id with =,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (is_primary)
);
create index employee_external_refs_employee_idx on employee_external_refs (employee_id);
create index employee_external_refs_lookup_idx on employee_external_refs (system_id, value);
create index employee_external_refs_value_trgm on employee_external_refs using gin (value gin_trgm_ops);

create table custom_field_definitions (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  entity text not null default 'employee' check (entity in ('employee')),
  key text not null check (key ~ '^[a-z][a-zA-Z0-9]{1,39}$'),
  label_ar text not null,
  label_en text,
  field_type text not null check (field_type in ('text', 'number', 'date', 'boolean', 'select')),
  -- خيارات القائمة: [{ value, labelAr, labelEn? }]
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  -- حساس: يُشفَّر في قاعدة البيانات ويُقنَّع في العرض ويُكشف بصلاحية مدقَّقة
  is_sensitive boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, entity, key)
);

do $$
declare t text;
begin
  foreach t in array array['external_systems', 'employee_external_refs', 'custom_field_definitions'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
end $$;

-- النظامان الافتراضيان للشركات القائمة
insert into external_systems (company_id, key, name_ar, name_en, purpose, ref_scope, is_unique, is_system)
select c.id, s.key, s.name_ar, s.name_en, s.purpose, s.ref_scope, true, true
  from companies c
 cross join (values
   ('accounting', 'رقم الموظف في برنامج المحاسبة', 'Accounting system number', 'accounting', 'company'),
   ('attendance_device', 'كود الموظف في جهاز البصمة', 'Fingerprint device code', 'attendance_device', 'branch')
 ) as s (key, name_ar, name_en, purpose, ref_scope);

-- Down Migration
drop table custom_field_definitions;
drop table employee_external_refs;
drop table external_systems;
