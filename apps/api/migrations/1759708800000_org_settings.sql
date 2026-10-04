-- Up Migration
-- المنظمة (فروع/أقسام/مسميات/درجات/مواقع/مراكز تكلفة) والعملات والإعدادات المتدرجة

create table currencies (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Z]{3}$'),
  name_ar text not null,
  name_en text,
  symbol text not null,
  symbol_position text not null default 'before' check (symbol_position in ('before', 'after')),
  display_decimals smallint not null default 2 check (display_decimals between 0 and 4),
  rounding_mode text not null default 'half_up' check (rounding_mode in ('half_up', 'half_even', 'down', 'up')),
  is_base boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create unique index currencies_one_base on currencies (company_id) where is_base;

create table branches (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  country text,
  city text,
  address text,
  phone text,
  timezone text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table departments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  parent_id uuid references departments (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (parent_id is distinct from id)
);
create index departments_parent_idx on departments (parent_id);

create table department_branches (
  department_id uuid not null references departments (id) on delete cascade,
  branch_id uuid not null references branches (id),
  company_id uuid not null references companies (id),
  primary key (department_id, branch_id)
);
create index department_branches_branch_idx on department_branches (branch_id);

-- كل قسم يرتبط بفرع واحد على الأقل (يُفحص عند COMMIT)
create function check_department_has_branch() returns trigger language plpgsql as $$
declare d uuid;
begin
  if tg_table_name = 'departments' then d := new.id; else d := old.department_id; end if;
  if exists (select 1 from departments where id = d)
     and not exists (select 1 from department_branches where department_id = d) then
    raise exception 'القسم يجب أن يرتبط بفرع واحد على الأقل' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger departments_need_branch after insert on departments
  deferrable initially deferred for each row execute function check_department_has_branch();
create constraint trigger department_branches_need_branch after delete on department_branches
  deferrable initially deferred for each row execute function check_department_has_branch();

create table job_grades (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  level integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table job_titles (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  job_grade_id uuid references job_grades (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table work_locations (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  branch_id uuid not null references branches (id),
  code text not null,
  name_ar text not null,
  name_en text,
  address text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table cost_centers (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  parent_id uuid references cost_centers (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (parent_id is distinct from id)
);

-- إعدادات متدرجة: شركة / فرع / مستخدم. الأولوية: المستخدم ثم الفرع ثم الشركة ثم الافتراضي (في الكود)
create table settings (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  scope_type text not null check (scope_type in ('company', 'branch', 'user')),
  scope_id uuid,
  key text not null,
  value jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  check ((scope_type = 'company') = (scope_id is null))
);
create unique index settings_uq on settings
  (company_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'), key);

do $$
declare t text;
begin
  foreach t in array array['currencies', 'branches', 'departments', 'job_grades', 'job_titles',
                           'work_locations', 'cost_centers'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
  execute 'create trigger settings_updated_at before update on settings for each row execute function set_updated_at()';

  foreach t in array array['currencies', 'branches', 'departments', 'job_grades', 'job_titles',
                           'work_locations', 'cost_centers', 'settings'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;

  foreach t in array array['currencies', 'branches', 'departments', 'department_branches', 'job_grades',
                           'job_titles', 'work_locations', 'cost_centers', 'settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table settings, cost_centers, work_locations, job_titles, job_grades, department_branches,
  departments, branches, currencies;
drop function check_department_has_branch();
