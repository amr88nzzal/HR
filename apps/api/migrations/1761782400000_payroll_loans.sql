-- Up Migration
-- 7c: السلف والأقساط والدفعات

create table loans (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  kind text not null default 'loan' check (kind in ('loan', 'advance')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  principal numeric(18, 4) not null check (principal > 0),
  installments_count integer not null check (installments_count between 1 and 120),
  first_year integer not null check (first_year between 2000 and 2100),
  first_month integer not null check (first_month between 1 and 12),
  reason text,
  status text not null default 'active' check (status in ('active', 'settled', 'cancelled')),
  cancel_reason text,
  created_by uuid references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loans_employee_idx on loans (employee_id, status);

create table loan_installments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  loan_id uuid not null references loans (id) on delete cascade,
  no integer not null,
  due_year integer not null,
  due_month integer not null check (due_month between 1 and 12),
  amount numeric(18, 4) not null check (amount > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'deducted', 'deferred', 'cancelled')),
  -- الدورة التي خُصم فيها القسط (أو رُحِّل بسبب سقف الصافي)
  period_id uuid references payroll_periods (id) on delete set null,
  payslip_id uuid references payslips (id) on delete set null,
  deferred_reason text,
  -- التأجيل التلقائي (سقف الصافي) يُلغى عند إعادة فتح الدورة؛ اليدوي لا
  system_deferred boolean not null default false,
  moved_to_id uuid references loan_installments (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (loan_id, no)
);
create index loan_installments_due_idx on loan_installments (company_id, due_year, due_month, status);

-- القسط المخطط خصمه في قسيمة (يُثبَّت عند القفل)
create table payslip_loan_items (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  payslip_id uuid not null references payslips (id) on delete cascade,
  installment_id uuid not null references loan_installments (id) on delete cascade,
  amount numeric(18, 4) not null,
  -- true = تجاوز سقف الصافي فيُرحَّل ولا يُخصم
  over_cap boolean not null default false,
  unique (payslip_id, installment_id)
);

alter table payslips
  add column loans_amount numeric(18, 4) not null default 0,
  add column payable_amount numeric(18, 4) not null default 0;
update payslips set payable_amount = net_amount;

create table payments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  kind text not null check (kind in ('payslip', 'loan')),
  employee_id uuid not null references employees (id),
  period_id uuid references payroll_periods (id) on delete cascade,
  payslip_id uuid references payslips (id) on delete cascade,
  loan_id uuid references loans (id) on delete cascade,
  amount numeric(18, 4) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  method text check (method in ('bank', 'cash', 'other')),
  reference text,
  paid_at date,
  note text,
  paid_by uuid references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'payslip' and payslip_id is not null) or (kind = 'loan' and loan_id is not null))
);
create unique index payments_payslip_uq on payments (payslip_id) where kind = 'payslip';
create unique index payments_loan_uq on payments (loan_id) where kind = 'loan';
create index payments_period_idx on payments (period_id, status);

do $$
declare t text;
begin
  foreach t in array array['loans', 'payments']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['loans', 'loan_installments', 'payments']
  loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
  foreach t in array array['loans', 'loan_installments', 'payslip_loan_items', 'payments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table payments, payslip_loan_items, loan_installments, loans;
alter table payslips drop column loans_amount, drop column payable_amount;
