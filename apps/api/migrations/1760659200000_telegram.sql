-- Up Migration
-- تلغرام كقناة إشعار: ربط حساب المستخدم برمز لمرة واحدة، وتسليمات تلغرام.
alter table notification_templates drop constraint notification_templates_channel_check;
alter table notification_templates
  add constraint notification_templates_channel_check check (channel in ('in_app', 'email', 'telegram'));
alter table notification_preferences drop constraint notification_preferences_channel_check;
alter table notification_preferences
  add constraint notification_preferences_channel_check check (channel in ('in_app', 'email', 'telegram'));
alter table notification_deliveries drop constraint notification_deliveries_channel_check;
alter table notification_deliveries
  add constraint notification_deliveries_channel_check check (channel in ('email', 'telegram'));

create table telegram_links (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  chat_id text not null,
  tg_username text,
  linked_at timestamptz not null default now(),
  unique (company_id, user_id),
  unique (company_id, chat_id)
);

create table telegram_link_codes (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);
create index telegram_link_codes_user_idx on telegram_link_codes (user_id);

do $$
declare t text;
begin
  foreach t in array array['telegram_links', 'telegram_link_codes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table telegram_link_codes, telegram_links;
alter table notification_deliveries drop constraint notification_deliveries_channel_check;
alter table notification_deliveries add constraint notification_deliveries_channel_check check (channel in ('email'));
alter table notification_preferences drop constraint notification_preferences_channel_check;
alter table notification_preferences add constraint notification_preferences_channel_check check (channel in ('in_app', 'email'));
alter table notification_templates drop constraint notification_templates_channel_check;
alter table notification_templates add constraint notification_templates_channel_check check (channel in ('in_app', 'email'));
