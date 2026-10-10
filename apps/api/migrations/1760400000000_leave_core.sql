-- Up Migration
-- نواة الإجازات: الأنواع والسياسات وتعيينها والعطل الرسمية.

create table leave_types (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_paid boolean not null default true,
  allow_half_day boolean not null default true,
  requires_attachment boolean not null default false,
  color text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);
create trigger leave_types_updated_at before update on leave_types
  for each row execute function set_updated_at();

create table leave_policies (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  leave_type_id uuid not null references leave_types (id),
  -- الاستحقاق السنوي بالأيام
  annual_entitlement numeric(6, 2) not null check (annual_entitlement >= 0),
  -- monthly: 1/12 شهرياً بالتناسب لمن يعيَّن أثناء السنة؛ upfront: كامل الرصيد أول السنة
  accrual_method text not null default 'monthly' check (accrual_method in ('monthly', 'upfront')),
  -- أقصى ما يُرحَّل لنهاية السنة (0 = لا ترحيل)
  carry_over_max numeric(6, 2) not null default 0 check (carry_over_max >= 0),
  -- مدة صلاحية المرحَّل بالأشهر من بداية السنة الجديدة (فارغ = بلا انتهاء)
  carry_over_valid_months integer check (carry_over_valid_months is null or carry_over_valid_months between 1 and 24),
  -- السماح بالرصيد السالب (حتى هذا الحد، 0 = لا سماح)
  max_negative numeric(6, 2) not null default 0 check (max_negative >= 0),
  min_service_months integer not null default 0 check (min_service_months >= 0),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, leave_type_id) references leave_types (company_id, id)
);
create index leave_policies_type_idx on leave_policies (leave_type_id);
create trigger leave_policies_updated_at before update on leave_policies
  for each row execute function set_updated_at();

-- تعيين سياسة على نطاق: الشركة كلها أو فرع أو قسم أو موظف. الأخص يغلب الأعم.
create table leave_policy_assignments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  policy_id uuid not null references leave_policies (id) on delete cascade,
  scope text not null check (scope in ('company', 'branch', 'department', 'employee')),
  scope_ref uuid,
  valid_from date not null default date '2000-01-01',
  created_at timestamptz not null default now(),
  check ((scope = 'company') = (scope_ref is null))
);
create unique index leave_policy_assignments_uniq
  on leave_policy_assignments (policy_id, scope, coalesce(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid));
create index leave_policy_assignments_scope_idx on leave_policy_assignments (company_id, scope, scope_ref);

-- العطل الرسمية (اليوم الكامل). تمتد لاحقاً في مرحلة الحضور.
create table holidays (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  holiday_date date not null,
  name_ar text not null,
  name_en text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, holiday_date)
);
create trigger holidays_updated_at before update on holidays
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['leave_types', 'leave_policies', 'leave_policy_assignments', 'holidays']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table holidays, leave_policy_assignments, leave_policies, leave_types;
