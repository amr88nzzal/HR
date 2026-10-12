-- Up Migration
-- الحضور 5b: البصمات (خام) وأيام الحضور المحتسبة.

-- البصمات الخام: أي مصدر (يدوي الآن، استيراد/جهاز لاحقاً). لا تُعدَّل، تُضاف أو تُحذف.
create table attendance_records (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  punched_at timestamptz not null,
  -- in/out إن عُرف من المصدر، وإلا فارغ (يُستنتج من الترتيب)
  direction text check (direction in ('in', 'out')),
  source text not null default 'manual' check (source in ('manual', 'import', 'device', 'correction')),
  note text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (company_id, employee_id, punched_at)
);
create index attendance_records_emp_time_idx on attendance_records (employee_id, punched_at);

-- يوم الحضور: القيم المحتسبة + تجاوز يدوي اختياري يبقى بعد إعادة الاحتساب (مع تحذير إن تغيّر الاحتساب)
create table attendance_days (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  day_date date not null,
  status text not null check (status in
    ('present', 'absent', 'leave', 'holiday', 'off', 'unscheduled', 'incomplete', 'pending')),
  shift_id uuid references shifts (id),
  scheduled_minutes integer not null default 0,
  first_in timestamptz,
  last_out timestamptz,
  worked_minutes integer not null default 0,
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  -- وقت داخل البصمتين خارج فترات الوردية (يتحوّل لإضافي بطلب معتمد فقط)
  surplus_minutes integer not null default 0,
  leave_units numeric(4, 2) not null default 0,
  override_status text check (override_status in
    ('present', 'absent', 'leave', 'holiday', 'off', 'unscheduled', 'incomplete', 'pending')),
  override_note text,
  override_by uuid references users (id),
  override_at timestamptz,
  baseline_status text,
  baseline_worked integer,
  -- الاحتساب تغيّر بعد التجاوز: تحتاج المراجعة
  diff_warning boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (company_id, employee_id, day_date)
);
create index attendance_days_date_idx on attendance_days (company_id, day_date);

do $$
declare t text;
begin
  foreach t in array array['attendance_records', 'attendance_days']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  create trigger attendance_records_audit after insert or update or delete on attendance_records
    for each row execute function audit_row_change('version', 'updated_at');
end $$;

-- Down Migration
drop table attendance_days, attendance_records;
