-- Up Migration
-- الإشعارات: داخل التطبيق + بريد. القوالب الافتراضية في الكود، وهذا الجدول للتخصيص فقط.

create table notifications (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  event_key text not null,
  category text not null,
  title text not null,
  body text not null,
  -- مسار داخل التطبيق يُفتح عند النقر (مثل /approvals/…)
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  -- false = لم تُعرض داخل التطبيق (عطّلها المستخدم) لكنها مرجع لتسليم البريد
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index notifications_user_read_idx on notifications (user_id, read_at, created_at desc);

create table notification_templates (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  event_key text not null,
  channel text not null check (channel in ('in_app', 'email')),
  locale text not null check (locale in ('ar', 'en')),
  subject text,
  body text not null,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, event_key, channel, locale)
);
create trigger notification_templates_updated_at before update on notification_templates
  for each row execute function set_updated_at();

create table notification_deliveries (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  notification_id uuid not null references notifications (id) on delete cascade,
  channel text not null check (channel in ('email')),
  to_address text not null,
  subject text not null,
  body text not null,
  body_html text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_deliveries_notification_idx on notification_deliveries (notification_id);
create index notification_deliveries_status_idx on notification_deliveries (company_id, status, created_at desc);
create trigger notification_deliveries_updated_at before update on notification_deliveries
  for each row execute function set_updated_at();

-- تفضيل المستخدم: غياب الصف = المفعّل افتراضياً. الفئات الإلزامية تتجاوز التفضيل في الكود.
create table notification_preferences (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  category text not null,
  channel text not null check (channel in ('in_app', 'email')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  unique (user_id, category, channel)
);
create trigger notification_preferences_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['notifications', 'notification_templates', 'notification_deliveries',
                           'notification_preferences']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table notification_preferences, notification_deliveries, notification_templates, notifications;
