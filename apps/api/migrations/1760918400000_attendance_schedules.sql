-- Up Migration
-- الحضور 5a: الورديات (بفترات) والجداول الأسبوعية وتعيينها.

create table shifts (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  color text,
  -- سماح التأخير والانصراف المبكر بالدقائق قبل أن يُحتسب نقص
  late_grace_minutes integer not null default 0 check (late_grace_minutes between 0 and 240),
  early_leave_grace_minutes integer not null default 0 check (early_leave_grace_minutes between 0 and 240),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);
create trigger shifts_updated_at before update on shifts
  for each row execute function set_updated_at();

-- فترات الوردية (دوام مقسوم = أكثر من فترة؛ الليلي: تنتهي في اليوم التالي)
create table shift_segments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  shift_id uuid not null references shifts (id) on delete cascade,
  position integer not null check (position >= 1),
  start_time time not null,
  end_time time not null,
  ends_next_day boolean not null default false,
  unique (shift_id, position),
  check (ends_next_day or end_time > start_time)
);

create table work_schedules (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);
create trigger work_schedules_updated_at before update on work_schedules
  for each row execute function set_updated_at();

-- وردية كل يوم من الأسبوع (0=الأحد … 6=السبت)؛ shift_id فارغ = يوم راحة
create table work_schedule_days (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  schedule_id uuid not null references work_schedules (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  shift_id uuid references shifts (id),
  unique (schedule_id, weekday)
);
create index work_schedule_days_shift_idx on work_schedule_days (shift_id);

-- تعيين جدول على نطاق بفترة صلاحية؛ الأخص يغلب ثم الأحدث بدءاً
create table schedule_assignments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  schedule_id uuid not null references work_schedules (id) on delete cascade,
  scope text not null check (scope in ('company', 'branch', 'department', 'employee')),
  scope_ref uuid,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  check ((scope = 'company') = (scope_ref is null)),
  check (valid_to is null or valid_to >= valid_from)
);
create unique index schedule_assignments_uniq on schedule_assignments
  (schedule_id, scope, coalesce(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid), valid_from);
create index schedule_assignments_scope_idx on schedule_assignments (company_id, scope, scope_ref);

do $$
declare t text;
begin
  foreach t in array array['shifts', 'shift_segments', 'work_schedules', 'work_schedule_days', 'schedule_assignments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  foreach t in array array['shifts', 'work_schedules', 'schedule_assignments']
  loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
end $$;

-- Down Migration
drop table schedule_assignments, work_schedule_days, work_schedules, shift_segments, shifts;
