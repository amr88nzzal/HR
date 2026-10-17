-- Up Migration
-- المرحلة 10: الإجراءات الإدارية (تنبيهات، عقوبات، مكافآت نقدية ومعنوية، ترقيات...) بأنواع قابلة للضبط.

create table admin_action_types (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_ar text not null check (length(name_ar) between 1 and 120),
  name_en text check (length(name_en) <= 120),
  category text not null check (category in
    ('notice', 'warning', 'penalty', 'reward_cash', 'reward_moral', 'commendation', 'promotion', 'other')),
  -- أثر الراتب: خصم أو إضافة لمرة واحدة تُغذّي دورة الرواتب بعد الاعتماد
  payroll_effect text not null default 'none' check (payroll_effect in ('none', 'deduction', 'bonus')),
  requires_approval boolean not null default true,
  requires_acknowledgment boolean not null default true,
  -- قالب كتاب رسمي (من وحدة الوثائق) يُصدَّر من السجل
  letter_template_code text,
  -- سلّم التصعيد (اقتراح فقط): عند بلوغ العدد خلال المدة يُقترح النوع التالي
  escalation_type_id uuid references admin_action_types (id),
  escalation_count smallint check (escalation_count between 2 and 20),
  escalation_window_days smallint check (escalation_window_days between 1 and 3650),
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  check (payroll_effect = 'none' or category in ('penalty', 'reward_cash')),
  check ((escalation_type_id is null) = (escalation_count is null)),
  check (escalation_window_days is null or escalation_type_id is not null)
);

create table admin_actions (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  type_id uuid not null references admin_action_types (id),
  -- draft: مسودة؛ pending: بانتظار الموافقة؛ approved: نافذ؛ rejected؛ cancelled: ملغى بعد الاعتماد أو قبله
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 4000),
  -- تاريخ الواقعة/القرار وتاريخ السريان
  action_date date not null,
  effective_date date not null,
  amount numeric(18, 4) check (amount > 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  -- الدورة المستهدفة للأثر المالي (سنة/شهر)، وتُعلَّم بالدورة عند القفل
  payroll_year smallint check (payroll_year between 2000 and 2100),
  payroll_month smallint check (payroll_month between 1 and 12),
  applied_period_id uuid references payroll_periods (id),
  -- الترقية: القيم الجديدة ونتائج التطبيق
  promotion jsonb,
  employment_change_id uuid references employment_changes (id),
  salary_id uuid references employee_salaries (id),
  approval_request_id uuid references approval_requests (id),
  issued_document_id uuid references issued_documents (id),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users (id),
  cancel_reason text,
  decided_at timestamptz,
  created_by uuid not null references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((amount is null) = (currency is null)),
  check ((payroll_year is null) = (payroll_month is null))
);
create index admin_actions_employee_idx on admin_actions (company_id, employee_id, action_date desc);
create index admin_actions_status_idx on admin_actions (company_id, status, created_at desc);
create index admin_actions_payroll_idx on admin_actions (company_id, payroll_year, payroll_month)
  where status = 'approved' and amount is not null;

do $$
declare t text;
begin
  foreach t in array array['admin_action_types', 'admin_actions']
  loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Down Migration
drop table admin_actions, admin_action_types;
