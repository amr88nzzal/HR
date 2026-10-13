-- Up Migration
-- 5e: تعديلات الحضور (بطلب موافقة أو مباشرة من الإدارة) وطلبات العمل الإضافي.

create table attendance_corrections (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  -- يوم الحضور (محلي) والتوقيتان الصحيحان للدخول والخروج
  day_date date not null,
  in_at timestamptz not null,
  out_at timestamptz not null,
  reason text not null,
  -- request: طلب موظف بموافقة؛ direct: تعديل مباشر من الإدارة (معتمد فوراً)
  method text not null check (method in ('request', 'direct')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  approval_request_id uuid references approval_requests (id),
  created_by uuid not null references users (id),
  decided_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (out_at > in_at)
);
create index attendance_corrections_emp_idx on attendance_corrections (company_id, employee_id, day_date);
create index attendance_corrections_status_idx on attendance_corrections (company_id, status, day_date);
-- طلب معلّق واحد لكل موظف في اليوم
create unique index attendance_corrections_pending_uq
  on attendance_corrections (company_id, employee_id, day_date) where status = 'pending';
create trigger attendance_corrections_updated_at before update on attendance_corrections
  for each row execute function set_updated_at();

create table overtime_requests (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  day_date date not null,
  minutes integer not null check (minutes > 0 and minutes <= 1440),
  reason text not null,
  -- pre: مسبق (اليوم أو بعده)؛ post: لاحق لعمل تم فعلاً
  kind text not null check (kind in ('pre', 'post')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  approval_request_id uuid references approval_requests (id),
  created_by uuid not null references users (id),
  decided_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index overtime_requests_emp_idx on overtime_requests (company_id, employee_id, day_date);
create index overtime_requests_status_idx on overtime_requests (company_id, status, day_date);
-- طلب فعّال واحد (معلّق أو معتمد) لكل موظف في اليوم
create unique index overtime_requests_active_uq
  on overtime_requests (company_id, employee_id, day_date) where status in ('pending', 'approved');
create trigger overtime_requests_updated_at before update on overtime_requests
  for each row execute function set_updated_at();

-- الإضافي المعتمد المحتسب = min(المعتمد، الفائض الفعلي)
alter table attendance_days add column overtime_minutes integer not null default 0;

do $$
declare t text;
begin
  foreach t in array array['attendance_corrections', 'overtime_requests']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  create trigger attendance_corrections_audit after insert or update or delete on attendance_corrections
    for each row execute function audit_row_change('version', 'updated_at');
  create trigger overtime_requests_audit after insert or update or delete on overtime_requests
    for each row execute function audit_row_change('version', 'updated_at');
end $$;

-- Down Migration
alter table attendance_days drop column overtime_minutes;
drop table overtime_requests, attendance_corrections;
