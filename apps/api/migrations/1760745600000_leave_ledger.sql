-- Up Migration
-- دفتر أستاذ الإجازات (إضافة فقط) والأرصدة المخزَّنة.
-- الدفعات (lots) = قيود موجبة بلا مصدر (استحقاق/ترحيل/تعديل). الاستهلاك والانتهاء والاستعادة قيود
-- تشير إلى الدفعة عبر source_entry_id، فالمتبقي = قيمة الدفعة + مجموع قيودها الفرعية.

create table leave_ledger (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  leave_type_id uuid not null references leave_types (id),
  entry_type text not null
    check (entry_type in ('accrual', 'carry_over', 'adjustment', 'consumption', 'restore', 'expiry')),
  days numeric(8, 2) not null check (days <> 0),
  effective_date date not null,
  -- للدفعات فقط: يوم انتهاء صلاحية المتبقي (مثل المرحَّل)
  expires_on date,
  source_entry_id uuid references leave_ledger (id),
  -- القيد الذي تعكسه الاستعادة
  reverses_entry_id uuid references leave_ledger (id),
  -- مفتاح عدم التكرار للاستحقاق: YYYY-MM (شهري) أو YYYY (دفعة واحدة/ترحيل)
  period text,
  -- طلب الإجازة (يُربَط بجدول الطلبات في 4c)
  request_id uuid,
  reason text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  check (entry_type not in ('accrual', 'carry_over') or (days > 0 and source_entry_id is null)),
  check (entry_type not in ('consumption', 'expiry') or days < 0),
  check (entry_type <> 'restore' or days > 0),
  check (entry_type <> 'adjustment' or days < 0 or source_entry_id is null)
);
create index leave_ledger_emp_type_idx on leave_ledger (company_id, employee_id, leave_type_id, effective_date);
create index leave_ledger_source_idx on leave_ledger (source_entry_id) where source_entry_id is not null;
create index leave_ledger_request_idx on leave_ledger (request_id) where request_id is not null;
create unique index leave_ledger_period_uniq
  on leave_ledger (company_id, employee_id, leave_type_id, entry_type, period)
  where period is not null and entry_type in ('accrual', 'carry_over');
create unique index leave_ledger_one_expiry on leave_ledger (source_entry_id) where entry_type = 'expiry';
create unique index leave_ledger_one_reversal on leave_ledger (reverses_entry_id) where reverses_entry_id is not null;

create function leave_ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'leave_ledger is append-only';
end $$;
create trigger leave_ledger_no_update before update or delete on leave_ledger
  for each row execute function leave_ledger_immutable();

create table leave_balances (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  leave_type_id uuid not null references leave_types (id),
  balance numeric(9, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id, leave_type_id)
);

create function leave_ledger_apply_balance() returns trigger language plpgsql as $$
begin
  insert into leave_balances (company_id, employee_id, leave_type_id, balance)
  values (new.company_id, new.employee_id, new.leave_type_id, new.days)
  on conflict (company_id, employee_id, leave_type_id)
  do update set balance = leave_balances.balance + new.days, updated_at = now();
  return new;
end $$;
create trigger leave_ledger_balance after insert on leave_ledger
  for each row execute function leave_ledger_apply_balance();

do $$
declare t text;
begin
  foreach t in array array['leave_ledger', 'leave_balances']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop trigger leave_ledger_balance on leave_ledger;
drop function leave_ledger_apply_balance();
drop table leave_balances;
drop table leave_ledger;
drop function leave_ledger_immutable();
