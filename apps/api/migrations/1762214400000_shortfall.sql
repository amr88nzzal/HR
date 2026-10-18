-- Up Migration
-- نقص الدوام (تأخير + مغادرة مبكرة): سياسة خصم، قرار المدير لكل موظف/شهر، ونتيجة محتسَبة لكل قسيمة.

create table shortfall_policies (
  company_id uuid primary key references companies (id),
  is_enabled boolean not null default false,
  -- minutes: دقائق الشهر (بعد السماحية) ÷ دقائق اليوم المكافئ؛ tiers: شرائح بعدد مرات النقص في الشهر
  method text not null default 'minutes' check (method in ('minutes', 'tiers')),
  count_late boolean not null default true,
  count_early boolean not null default true,
  monthly_free_minutes integer not null default 0 check (monthly_free_minutes between 0 and 10000),
  minutes_per_day integer not null default 480 check (minutes_per_day between 60 and 1440),
  -- [{ "from": 4, "dayFraction": "0.25" }, ...]
  tiers jsonb not null default '[]'::jsonb,
  -- الهدف الافتراضي: من الراتب أو من رصيد الإجازات (والباقي من الراتب عند عدم كفاية الرصيد)
  default_target text not null default 'salary' check (default_target in ('salary', 'leave')),
  leave_type_id uuid references leave_types (id),
  -- اقتراح إجراء إداري عند بلوغ عدد مرات النقص في الشهر
  suggest_action_after smallint check (suggest_action_after between 1 and 31),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_target <> 'leave' or leave_type_id is not null)
);

create table shortfall_decisions (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  year smallint not null check (year between 2000 and 2100),
  month smallint not null check (month between 1 and 12),
  -- salary: كله من الراتب؛ leave: كله من الرصيد؛ split: جزء من الرصيد والباقي من الراتب؛ waive: إعفاء
  target text not null check (target in ('salary', 'leave', 'split', 'waive')),
  leave_days numeric(8, 2) check (leave_days > 0),
  reason text not null check (length(reason) between 2 and 300),
  decided_by uuid references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id, year, month),
  check ((target = 'split') = (leave_days is not null))
);

-- نتيجة الاحتساب المحفوظة مع القسيمة: تُقرأ عند القفل لخصم الرصيد وعند إعادة الفتح لإعادته
create table payslip_shortfalls (
  payslip_id uuid primary key references payslips (id) on delete cascade,
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  leave_type_id uuid references leave_types (id),
  late_minutes integer not null default 0,
  early_minutes integer not null default 0,
  occurrences integer not null default 0,
  chargeable_minutes integer not null default 0,
  days_due numeric(8, 4) not null default 0,
  days_leave numeric(8, 2) not null default 0,
  days_salary numeric(8, 4) not null default 0,
  target text not null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index payslip_shortfalls_emp_idx on payslip_shortfalls (company_id, employee_id);

do $$
declare t text;
begin
  foreach t in array array['shortfall_policies', 'shortfall_decisions']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
  foreach t in array array['shortfall_policies', 'shortfall_decisions', 'payslip_shortfalls']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table payslip_shortfalls, shortfall_decisions, shortfall_policies;
