-- Up Migration
create table user_table_prefs (
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  table_id text not null check (table_id ~ '^[a-z][a-z0-9._-]{0,63}$'),
  prefs jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, table_id)
);
alter table user_table_prefs enable row level security;
create policy tenant_isolation on user_table_prefs
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table user_table_prefs;
