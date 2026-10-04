-- Up Migration
-- الهوية والصلاحيات والتدقيق + عزل الشركات (RLS)

create extension if not exists citext;

-- دور التطبيق: ليس مالك الجداول، فتسري عليه سياسات RLS. كلمة المرور وصلاحية الدخول تُضبطان بأمر post-migrate.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hrms_app') then
    create role hrms_app nologin;
  end if;
end $$;

create table companies (
  id uuid primary key default uuidv7(),
  slug citext not null unique,
  name_ar text not null,
  name_en text,
  timezone text not null default 'Asia/Riyadh',
  default_locale text not null default 'ar',
  status text not null default 'active' check (status in ('active', 'suspended')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

create table users (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  email citext not null,
  username citext,
  display_name text not null,
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  must_change_password boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz not null default now(),
  totp_secret text,
  totp_enabled boolean not null default false,
  permissions_version integer not null default 1,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email),
  unique (company_id, username)
);
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

create table refresh_tokens (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  device_info text,
  ip inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_id uuid references refresh_tokens (id),
  created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

create table password_resets (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- كتالوج الصلاحيات عام (بلا company_id) ويُزامَن من الكود
create table permissions (
  id uuid primary key default uuidv7(),
  code text not null unique,
  module text not null,
  resource text not null,
  action text not null,
  description_ar text
);

create table roles (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  name_ar text not null,
  name_en text,
  is_system boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create trigger roles_updated_at before update on roles
  for each row execute function set_updated_at();

create table role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_id uuid not null references permissions (id) on delete cascade,
  company_id uuid not null references companies (id),
  primary key (role_id, permission_id)
);

create table user_role_assignments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  user_id uuid not null references users (id) on delete cascade,
  role_id uuid not null references roles (id),
  scope_type text not null check (scope_type in ('company', 'branch', 'department', 'team', 'self')),
  scope_id uuid,
  created_at timestamptz not null default now(),
  check ((scope_type in ('company', 'self')) = (scope_id is null))
);
create unique index user_role_assignments_uq
  on user_role_assignments (user_id, role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));

-- سجل التدقيق: إضافة فقط. (التقسيم الشهري مؤجَّل، انظر docs/PLAN.md)
create table audit_logs (
  id uuid primary key default uuidv7(),
  company_id uuid not null,
  occurred_at timestamptz not null default now(),
  user_id uuid,
  entity_type text not null,
  entity_id text,
  action text not null,
  changes jsonb,
  request_id text,
  ip inet
);
create index audit_logs_entity_idx on audit_logs (company_id, entity_type, entity_id, occurred_at);
create index audit_logs_time_idx on audit_logs (company_id, occurred_at desc);

-- مشغّل تدقيق عام: يسجّل الفروق فقط، ويستثني الأعمدة الحساسة/الكثيرة التغيّر (وسائط المشغّل)
create function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  excluded text[] := coalesce(tg_argv, '{}');
  old_j jsonb;
  new_j jsonb;
  diff jsonb;
  row_j jsonb;
  v_company uuid;
begin
  if tg_op = 'INSERT' then
    row_j := to_jsonb(new) - excluded;
    diff := row_j;
  elsif tg_op = 'UPDATE' then
    old_j := to_jsonb(old) - excluded;
    new_j := to_jsonb(new) - excluded;
    select jsonb_object_agg(n.key, jsonb_build_object('old', old_j -> n.key, 'new', n.value))
      into diff
      from jsonb_each(new_j) n
     where old_j -> n.key is distinct from n.value;
    if diff is null then
      return new;
    end if;
    row_j := new_j;
  else
    row_j := to_jsonb(old) - excluded;
    diff := row_j;
  end if;

  v_company := case when tg_table_name = 'companies' then (row_j ->> 'id')::uuid
                    else (row_j ->> 'company_id')::uuid end;

  insert into audit_logs (company_id, user_id, entity_type, entity_id, action, changes, request_id)
  values (
    v_company,
    nullif(current_setting('app.user_id', true), '')::uuid,
    tg_table_name,
    row_j ->> 'id',
    lower(tg_op),
    diff,
    nullif(current_setting('app.request_id', true), '')
  );
  return coalesce(new, old);
end;
$$;

create trigger companies_audit after insert or update or delete on companies
  for each row execute function audit_row_change('version', 'updated_at');
create trigger users_audit after insert or update or delete on users
  for each row execute function audit_row_change(
    'password_hash', 'totp_secret', 'failed_attempts', 'locked_until', 'last_login_at',
    'permissions_version', 'version', 'updated_at');
create trigger roles_audit after insert or update or delete on roles
  for each row execute function audit_row_change('version', 'updated_at');
create trigger user_role_assignments_audit after insert or update or delete on user_role_assignments
  for each row execute function audit_row_change();

-- رفع permissions_version عند تغيّر ما يؤثر على صلاحيات المستخدم، فتسقط الذاكرة المؤقتة فوراً
create function bump_permissions_version() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'user_role_assignments' then
    if tg_op in ('UPDATE', 'DELETE') then
      update users set permissions_version = permissions_version + 1 where id = old.user_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      update users set permissions_version = permissions_version + 1 where id = new.user_id;
    end if;
  else
    update users set permissions_version = permissions_version + 1
     where id in (select user_id from user_role_assignments
                   where role_id = coalesce(new.role_id, old.role_id));
  end if;
  return null;
end;
$$;
create trigger user_role_assignments_bump after insert or update or delete on user_role_assignments
  for each row execute function bump_permissions_version();
create trigger role_permissions_bump after insert or update or delete on role_permissions
  for each row execute function bump_permissions_version();

-- حل الشركة من الـ slug قبل تسجيل الدخول (لا سياق شركة بعد)؛ لا يكشف غير المعرّف
create function login_company_id(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from companies where slug = p_slug::citext and status = 'active'
$$;
revoke all on function login_company_id(text) from public;
grant execute on function login_company_id(text) to hrms_app;

-- RLS: مفعّل (وليس FORCE) فيسري على hrms_app ويتجاوزه المالك لأعمال الترحيل والـ CLI
alter table companies enable row level security;
create policy tenant_isolation on companies
  using (id = nullif(current_setting('app.company_id', true), '')::uuid);

do $$
declare t text;
begin
  foreach t in array array['users', 'refresh_tokens', 'password_resets', 'roles',
                           'role_permissions', 'user_role_assignments', 'audit_logs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;

-- الصلاحيات
grant usage on schema public to hrms_app;
grant select, update on companies to hrms_app;
grant select, insert, update, delete on users, refresh_tokens, password_resets, roles,
  role_permissions, user_role_assignments to hrms_app;
grant select on permissions to hrms_app;
grant select, insert on audit_logs to hrms_app;
-- جداول المراحل القادمة: صلاحيات CRUD افتراضية لمستخدم التطبيق (تُسحب صراحةً حيث يلزم، كـ audit_logs)
alter default privileges in schema public grant select, insert, update, delete on tables to hrms_app;

-- Down Migration
drop function login_company_id(text);
drop table audit_logs, user_role_assignments, role_permissions, roles, permissions,
  password_resets, refresh_tokens, users, companies;
drop function bump_permissions_version();
drop function audit_row_change();
