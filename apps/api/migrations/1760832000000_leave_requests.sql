-- Up Migration
-- طلبات الإجازة وتفصيل أيامها. الرصيد يُحجز في الدفتر عند التقديم ويُستعاد عند الرفض/السحب/الإلغاء.
create table leave_requests (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  leave_type_id uuid not null references leave_types (id),
  start_date date not null,
  end_date date not null,
  -- نصف يوم في أول/آخر يوم (إن كان يوم عمل ويسمح النوع)
  first_day_half boolean not null default false,
  last_day_half boolean not null default false,
  reason text,
  -- الأيام المحسوبة آلياً (تستثني الراحة الأسبوعية والعطل الرسمية)
  days numeric(6, 2) not null check (days > 0),
  -- تجاوز يدوي لعدد الأيام المخصومة (موارد بشرية)
  override_days numeric(6, 2) check (override_days is null or override_days >= 0),
  override_reason text,
  override_by uuid references users (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  approval_request_id uuid references approval_requests (id),
  cancelled_at timestamptz,
  cancelled_by uuid references users (id),
  created_by uuid not null references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_emp_idx on leave_requests (company_id, employee_id, start_date);
create index leave_requests_status_idx on leave_requests (company_id, status, start_date);
create trigger leave_requests_updated_at before update on leave_requests
  for each row execute function set_updated_at();

create table leave_request_days (
  company_id uuid not null references companies (id),
  request_id uuid not null references leave_requests (id) on delete cascade,
  day_date date not null,
  -- 1.00 يوم كامل، 0.50 نصف يوم، 0 يوم غير محتسب (راحة/عطلة)
  units numeric(3, 2) not null check (units >= 0 and units <= 1),
  kind text not null check (kind in ('work', 'weekend', 'holiday')),
  primary key (request_id, day_date)
);
create index leave_request_days_date_idx on leave_request_days (company_id, day_date);

do $$
declare t text;
begin
  foreach t in array array['leave_requests', 'leave_request_days']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- ربط قيود الدفتر بالطلب
alter table leave_ledger add constraint leave_ledger_request_fk
  foreign key (request_id) references leave_requests (id);

-- Down Migration
alter table leave_ledger drop constraint leave_ledger_request_fk;
drop table leave_request_days, leave_requests;
