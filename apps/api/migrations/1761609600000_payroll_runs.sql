-- Up Migration
-- 7b: مجموعات الدفع والدورات والقسائم وبنودها والمدخلات وأسباب التجاوز اليدوي.

alter table pay_components add column prorate boolean not null default true;

create table pay_groups (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create unique index pay_groups_one_default on pay_groups (company_id) where is_default;

-- تعيين الموظف لمجموعة (بلا تعيين = المجموعة الافتراضية)
create table pay_group_assignments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  pay_group_id uuid not null references pay_groups (id),
  employee_id uuid not null references employees (id) on delete cascade,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (employee_id with =, daterange(valid_from, valid_to, '[]') with &&)
);
create index pay_group_assignments_group_idx on pay_group_assignments (pay_group_id);

create table override_reasons (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

-- دورة رواتب: مجموعة دفع × شهر × عملة
create table payroll_periods (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  pay_group_id uuid not null references pay_groups (id),
  year smallint not null check (year between 2000 and 2100),
  month smallint not null check (month between 1 and 12),
  start_date date not null,
  end_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'locked')),
  calculated_at timestamptz,
  approved_by uuid references users (id),
  approved_at timestamptz,
  locked_by uuid references users (id),
  locked_at timestamptz,
  reopen_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, pay_group_id, year, month, currency),
  check (end_date >= start_date)
);

-- سجل تشغيلات الاحتساب (للتدقيق)
create table payroll_runs (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  period_id uuid not null references payroll_periods (id) on delete cascade,
  run_no integer not null,
  employees_count integer not null,
  error_count integer not null default 0,
  totals jsonb not null default '{}',
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (period_id, run_no)
);

create table payslips (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  period_id uuid not null references payroll_periods (id) on delete cascade,
  employee_id uuid not null references employees (id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'calculated' check (status in ('calculated', 'error')),
  basic_amount numeric(18, 4) not null default 0,
  gross_amount numeric(18, 4) not null default 0,
  deductions_amount numeric(18, 4) not null default 0,
  net_amount numeric(18, 4) not null default 0,
  employer_amount numeric(18, 4) not null default 0,
  -- لقطة المدخلات: المتغيرات ونسبة التناسب والأساسي
  inputs jsonb not null default '{}',
  warnings jsonb not null default '[]',
  error text,
  has_manual boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index payslips_employee_idx on payslips (employee_id, period_id);

create table payslip_lines (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  payslip_id uuid not null references payslips (id) on delete cascade,
  -- بلا مكوّن: سطر الأساسي، أو سطر مضاف يدوياً
  component_id uuid references pay_components (id),
  code text not null,
  name_ar text not null,
  name_en text,
  kind text not null check (kind in ('earning', 'deduction', 'employer')),
  amount numeric(18, 4) not null,
  -- القيمة الآلية الأخيرة (لقطة) ووقت التجاوز لتحذير الفرق
  auto_amount numeric(18, 4),
  auto_at_override numeric(18, 4),
  is_manual boolean not null default false,
  is_added boolean not null default false,
  override_reason_id uuid references override_reasons (id),
  override_note text,
  override_by uuid references users (id),
  override_at timestamptz,
  -- كيف حُسب؟
  explain jsonb not null default '{}',
  sort_order integer not null default 100,
  unique (payslip_id, code)
);

-- مدخلات يدوية لكل موظف/دورة تتجاوز المتغيرات الآلية
create table payroll_inputs (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  period_id uuid not null references payroll_periods (id) on delete cascade,
  employee_id uuid not null references employees (id),
  key text not null,
  value numeric(18, 4) not null,
  note text,
  updated_by uuid references users (id),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id, key)
);

do $$
declare t text;
begin
  foreach t in array array['pay_groups', 'override_reasons', 'payroll_periods', 'payslips']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['pay_groups', 'override_reasons', 'payroll_periods', 'payroll_inputs']
  loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
  -- القسائم: لا تُدقَّق لقطة المدخلات الكبيرة؛ والبنود تُدقَّق تعديلاتها (التجاوز اليدوي) لا إدراجها الجماعي
  create trigger payslips_audit after insert or update or delete on payslips
    for each row execute function audit_row_change('version', 'updated_at', 'inputs');
  create trigger payslip_lines_audit after update on payslip_lines
    for each row execute function audit_row_change('version', 'updated_at', 'explain');
  foreach t in array array['pay_groups', 'pay_group_assignments', 'override_reasons', 'payroll_periods',
    'payroll_runs', 'payslips', 'payslip_lines', 'payroll_inputs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table payroll_inputs, payslip_lines, payslips, payroll_runs, payroll_periods,
  override_reasons, pay_group_assignments, pay_groups;
alter table pay_components drop column prorate;
