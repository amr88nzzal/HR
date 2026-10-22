-- Up Migration
-- أنواع السلف القابلة للضبط (قرض/سلفة/فاتورة ذمم…) + تاريخ الحدث + مرجع الفاتورة.
-- Configurable loan types (loan / advance / receivable invoice …) + event date + invoice reference.

create table loan_types (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_ar text not null,
  name_en text not null,
  color text not null default '#4c6ef5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- true = يُصرف نقداً للموظف (سلفة/قرض)؛ false = شراء بالآجل لا صرف فيه (ذمم)
  -- true = cash is paid out to the employee; false = purchase on credit, nothing is paid out
  disburses boolean not null default true,
  max_installments integer not null default 12 check (max_installments between 1 and 120),
  -- حد الأقساط الشهرية كنسبة من الراتب الأساسي (تنبيه فقط)
  monthly_limit_percent numeric(5, 2) check (monthly_limit_percent > 0 and monthly_limit_percent <= 100),
  gl_account text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create trigger loan_types_updated_at before update on loan_types for each row execute function set_updated_at();
create trigger loan_types_audit after insert or update or delete on loan_types
  for each row execute function audit_row_change('version', 'updated_at');
alter table loan_types enable row level security;
create policy tenant_isolation on loan_types
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

insert into loan_types (company_id, code, name_ar, name_en, color, disburses, max_installments, sort_order)
select c.id, v.code, v.name_ar, v.name_en, v.color, v.disburses, v.max_inst, v.ord
from companies c
cross join (values
  ('loan', 'قرض', 'Loan', '#4c6ef5', true, 60, 1),
  ('advance', 'سلفة', 'Advance', '#fd7e14', true, 12, 2),
  ('receivable', 'فاتورة ذمم', 'Receivable invoice', '#12b886', false, 12, 3)
) as v (code, name_ar, name_en, color, disburses, max_inst, ord);

alter table loans
  add column type_id uuid references loan_types (id),
  add column event_date date,
  add column reference text;
update loans l set type_id = t.id
  from loan_types t where t.company_id = l.company_id and t.code = l.kind;
update loans set event_date = created_at::date;
alter table loans alter column type_id set not null, alter column event_date set not null;
alter table loans drop constraint loans_kind_check;
create index loans_event_idx on loans (company_id, event_date);

-- Down Migration
drop index loans_event_idx;
alter table loans drop column type_id, drop column event_date, drop column reference;
alter table loans add constraint loans_kind_check check (kind in ('loan', 'advance'));
drop table loan_types;
