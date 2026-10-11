-- Up Migration
-- إعدادات قنوات الإشعار لكل شركة (SMTP، تلغرام). الأسرار مشفّرة بتشفير الحقول.
create table integration_settings (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  provider text not null check (provider in ('email', 'telegram')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  secret_enc text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);
create trigger integration_settings_updated_at before update on integration_settings
  for each row execute function set_updated_at();
alter table integration_settings enable row level security;
create policy tenant_isolation on integration_settings
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table integration_settings;
