-- Up Migration
-- سجل المهام الخلفية كما يراه المستخدم (الطابور نفسه في مخطط pgboss الذي يثبّته أمر post-migrate)

create table job_runs (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  -- اسم المهمة المنطقي (مثل system.cleanup) والطابور الذي تعمل فيه
  job_name text not null,
  queue text not null check (queue in ('critical', 'default', 'bulk', 'render')),
  -- معرّف المهمة في pg-boss (يُملأ عند الإدراج)
  boss_job_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  -- إعادة تشغيل يدوية من مهمة فاشلة
  retry_of uuid references job_runs (id),
  requested_by uuid references users (id),
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create index job_runs_company_created_idx on job_runs (company_id, created_at desc);
create index job_runs_company_status_idx on job_runs (company_id, status, created_at desc);
create unique index job_runs_boss_job_uidx on job_runs (boss_job_id) where boss_job_id is not null;
create trigger job_runs_updated_at before update on job_runs
  for each row execute function set_updated_at();

alter table job_runs enable row level security;
create policy tenant_isolation on job_runs
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table job_runs;
