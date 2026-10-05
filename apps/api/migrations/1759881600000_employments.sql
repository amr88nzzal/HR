-- Up Migration
-- العقود والتعيين الإداري عبر الزمن وتغييرات الموظف

create extension if not exists btree_gist;

-- «اليوم» بتوقيت الشركة (يُستخدم لتحديد التعيين الحالي ونطاقات الصلاحيات)
create function company_today(p_company uuid) returns date
language sql stable as $$
  select (now() at time zone coalesce((select timezone from companies where id = p_company), 'UTC'))::date
$$;

-- نطاق «الفريق» ديناميكي (المرؤوسون المباشرون) فلا يحتاج معرّفاً
alter table user_role_assignments drop constraint user_role_assignments_check;
alter table user_role_assignments add constraint user_role_assignments_check
  check ((scope_type in ('company', 'self', 'team')) = (scope_id is null));

create table change_reasons (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  change_type text not null check (change_type in
    ('hire', 'transfer', 'promotion', 'manager_change', 'suspension', 'reinstatement', 'termination')),
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table contracts (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  contract_type text not null check (contract_type in
    ('permanent', 'fixed_term', 'temporary', 'part_time', 'internship', 'contractor')),
  start_date date not null,
  end_date date,
  probation_end_date date,
  notice_days integer check (notice_days is null or notice_days between 0 and 365),
  status text not null default 'active' check (status in ('draft', 'active', 'ended', 'terminated')),
  file_id uuid,
  terms jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (probation_end_date is null or probation_end_date >= start_date),
  -- عقد نشط واحد في أي لحظة للموظف
  exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status = 'active')
);
create index contracts_employee_idx on contracts (employee_id);

create table employments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  contract_id uuid references contracts (id),
  branch_id uuid not null references branches (id),
  department_id uuid not null,
  job_title_id uuid references job_titles (id),
  job_grade_id uuid references job_grades (id),
  manager_employee_id uuid references employees (id),
  cost_center_id uuid references cost_centers (id),
  work_location_id uuid references work_locations (id),
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'temporary', 'contractor')),
  work_mode text not null default 'onsite' check (work_mode in ('onsite', 'remote', 'hybrid')),
  work_country text check (work_country ~ '^[A-Z]{2}$'),
  valid_from date not null,
  valid_to date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (manager_employee_id is distinct from employee_id),
  -- القسم متاح في فرع التعيين
  foreign key (department_id, branch_id) references department_branches (department_id, branch_id),
  -- لا تداخل بين فترات تعيين الموظف
  exclude using gist (employee_id with =, daterange(valid_from, valid_to, '[]') with &&)
);
create index employments_employee_idx on employments (employee_id, valid_from desc);
create index employments_branch_idx on employments (branch_id) where valid_to is null;
create index employments_department_idx on employments (department_id) where valid_to is null;
create index employments_manager_idx on employments (manager_employee_id) where valid_to is null;

-- سجل الأحداث (للإضافة فقط من التطبيق): كل حدث ينتج صف employments جديداً أو يغيّر الحالة
create table employment_changes (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  change_type text not null check (change_type in
    ('hire', 'transfer', 'promotion', 'manager_change', 'suspension', 'reinstatement', 'termination')),
  effective_date date not null,
  reason_id uuid references change_reasons (id),
  notes text,
  from_employment_id uuid references employments (id),
  to_employment_id uuid references employments (id),
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index employment_changes_employee_idx on employment_changes (employee_id, effective_date desc);

do $$
declare t text;
begin
  foreach t in array array['change_reasons', 'contracts', 'employments'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['change_reasons', 'contracts', 'employments', 'employment_changes'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
delete from user_role_assignments where scope_type = 'team';
alter table user_role_assignments drop constraint user_role_assignments_check;
alter table user_role_assignments add constraint user_role_assignments_check
  check ((scope_type in ('company', 'self')) = (scope_id is null));
drop table employment_changes, employments, contracts, change_reasons;
drop function company_today(uuid);
