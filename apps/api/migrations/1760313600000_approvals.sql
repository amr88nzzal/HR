-- Up Migration
-- محرك الموافقات: سلاسل بخطوات وشروط، طلبات، معتمدون، أثر الإجراءات، وتفويض زمني.

create table approval_flows (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null,
  request_type text not null,
  name_ar text not null,
  name_en text,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);
-- سلسلة فعّالة واحدة لكل نوع طلب
create unique index approval_flows_active_type_idx on approval_flows (company_id, request_type) where is_active;
create trigger approval_flows_updated_at before update on approval_flows
  for each row execute function set_updated_at();

create table approval_steps (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  flow_id uuid not null references approval_flows (id) on delete cascade,
  position integer not null check (position >= 1),
  name_ar text not null,
  name_en text,
  approver_type text not null check (approver_type in ('direct_manager', 'manager_of_manager', 'role', 'user')),
  -- معرّف الدور أو المستخدم حسب النوع (فارغ للمدير المباشر/مدير المدير)
  approver_ref uuid,
  mode text not null default 'any' check (mode in ('any', 'all')),
  -- شرط على بيانات الطلب؛ فارغ = الخطوة دائماً
  condition jsonb,
  unique (flow_id, position),
  check ((approver_type in ('role', 'user')) = (approver_ref is not null))
);

create table approval_requests (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  flow_id uuid not null references approval_flows (id),
  request_type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  requester_user_id uuid not null references users (id),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'returned', 'withdrawn')),
  current_step_id uuid references approval_steps (id) on delete set null,
  current_position integer,
  final_note text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create index approval_requests_requester_idx on approval_requests (requester_user_id, created_at desc);
create index approval_requests_entity_idx on approval_requests (company_id, entity_type, entity_id);
create trigger approval_requests_updated_at before update on approval_requests
  for each row execute function set_updated_at();

create table approval_request_assignees (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  request_id uuid not null references approval_requests (id) on delete cascade,
  step_id uuid references approval_steps (id) on delete set null,
  position integer not null,
  user_id uuid not null references users (id),
  -- عند التفويض: المعتمد الأصلي الذي ينوب عنه هذا المستخدم
  delegated_from_user_id uuid references users (id),
  status text not null default 'pending' check (status in ('pending', 'acted', 'cancelled')),
  acted_at timestamptz,
  created_at timestamptz not null default now()
);
create index approval_assignees_user_idx on approval_request_assignees (user_id, status);
create index approval_assignees_request_idx on approval_request_assignees (request_id, position);

create table approval_actions (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  request_id uuid not null references approval_requests (id) on delete cascade,
  step_id uuid references approval_steps (id) on delete set null,
  position integer,
  actor_user_id uuid not null references users (id),
  on_behalf_of_user_id uuid references users (id),
  action text not null check (action in ('submit', 'resubmit', 'approve', 'reject', 'return', 'withdraw')),
  note text,
  created_at timestamptz not null default now()
);
create index approval_actions_request_idx on approval_actions (request_id, created_at);

create table approver_delegations (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  delegator_user_id uuid not null references users (id) on delete cascade,
  delegate_user_id uuid not null references users (id) on delete cascade,
  valid_from date not null,
  valid_to date not null,
  -- فارغ = كل أنواع الطلبات
  request_type text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (valid_from <= valid_to),
  check (delegator_user_id <> delegate_user_id)
);
create index approver_delegations_delegator_idx on approver_delegations (delegator_user_id, valid_from, valid_to);

do $$
declare t text;
begin
  foreach t in array array['approval_flows', 'approval_steps', 'approval_requests',
                           'approval_request_assignees', 'approval_actions', 'approver_delegations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table approver_delegations, approval_actions, approval_request_assignees,
  approval_requests, approval_steps, approval_flows;
