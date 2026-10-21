-- Up Migration
-- قوالب قسيمة الراتب: إعدادات منظَّمة (JSON) لكل شركة، وقالب افتراضي واحد على الأكثر
-- Payslip templates: structured (JSON) settings per company, at most one default
create table payslip_templates (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  name_ar text not null,
  name_en text,
  config jsonb not null,
  is_default boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payslip_templates_one_default on payslip_templates (company_id) where is_default;
create index payslip_templates_company_idx on payslip_templates (company_id, name_ar);
create trigger payslip_templates_updated_at before update on payslip_templates
  for each row execute function set_updated_at();

alter table payslip_templates enable row level security;
create policy tenant_isolation on payslip_templates
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
create trigger payslip_templates_audit after insert or update or delete on payslip_templates
  for each row execute function audit_row_change('version', 'updated_at');

-- Down Migration
drop table payslip_templates;
