-- Up Migration
-- 7a: هيكل الرواتب — أسس الاحتساب، المكونات، جداول النسب، الهياكل، ورواتب الموظفين بخط زمني.

create table payroll_bases (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  includes_basic boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table rate_tables (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  mode text not null check (mode in ('progressive', 'slab')),
  -- الشرائح: [{from,to,rate,fixed}] نصوص عشرية، مفحوصة بـ Zod (متصلة وأولها صفر وآخرها مفتوحة)
  brackets jsonb not null,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table pay_components (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  kind text not null check (kind in ('earning', 'deduction', 'employer')),
  calc_type text not null check (calc_type in ('fixed', 'percent', 'formula', 'rate_table')),
  fixed_amount numeric(18, 4) check (fixed_amount is null or fixed_amount >= 0),
  percent numeric(8, 4) check (percent is null or percent >= 0),
  -- أساس النسبة، أو المبلغ الذي يُطبَّق عليه جدول النسب
  base_id uuid references payroll_bases (id),
  formula text,
  rate_table_id uuid references rate_tables (id),
  rounding_decimals smallint not null default 2 check (rounding_decimals between 0 and 4),
  display_order integer not null default 100,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (calc_type <> 'fixed' or fixed_amount is not null),
  check (calc_type <> 'percent' or (percent is not null and base_id is not null)),
  check (calc_type <> 'formula' or formula is not null),
  check (calc_type <> 'rate_table' or (rate_table_id is not null and base_id is not null))
);

-- المكونات الداخلة في كل أساس
create table pay_component_bases (
  company_id uuid not null references companies (id),
  base_id uuid not null references payroll_bases (id) on delete cascade,
  component_id uuid not null references pay_components (id),
  primary key (base_id, component_id)
);
create index pay_component_bases_comp_idx on pay_component_bases (component_id);

create table salary_structures (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table salary_structure_components (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  structure_id uuid not null references salary_structures (id) on delete cascade,
  component_id uuid not null references pay_components (id),
  amount numeric(18, 4) check (amount is null or amount >= 0),
  percent numeric(8, 4) check (percent is null or percent >= 0),
  unique (structure_id, component_id)
);
create index salary_structure_components_comp_idx on salary_structure_components (component_id);

-- راتب الموظف بخط زمني بلا تداخل (الراتب الأساسي + العملة + الهيكل)
create table employee_salaries (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  structure_id uuid references salary_structures (id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  basic_amount numeric(18, 4) not null check (basic_amount >= 0),
  valid_from date not null,
  valid_to date,
  note text,
  created_by uuid references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (employee_id with =, daterange(valid_from, valid_to, '[]') with &&)
);
create index employee_salaries_emp_idx on employee_salaries (employee_id, valid_from desc);

create table employee_salary_components (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_salary_id uuid not null references employee_salaries (id) on delete cascade,
  component_id uuid not null references pay_components (id),
  amount numeric(18, 4) check (amount is null or amount >= 0),
  percent numeric(8, 4) check (percent is null or percent >= 0),
  unique (employee_salary_id, component_id)
);
create index employee_salary_components_comp_idx on employee_salary_components (component_id);

do $$
declare t text;
begin
  foreach t in array array['payroll_bases', 'rate_tables', 'pay_components', 'salary_structures', 'employee_salaries']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
  foreach t in array array['payroll_bases', 'rate_tables', 'pay_components', 'pay_component_bases',
    'salary_structures', 'salary_structure_components', 'employee_salaries', 'employee_salary_components']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table employee_salary_components, employee_salaries, salary_structure_components,
  salary_structures, pay_component_bases, pay_components, rate_tables, payroll_bases;
