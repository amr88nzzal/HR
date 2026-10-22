-- Up Migration
-- ربط بنود الراتب بحسابات المحاسبة + حسابات الشركة العامة لقيد اليومية.
-- Maps pay components to GL accounts + company-level accounts for the payroll journal entry.
alter table pay_components
  add column gl_account text check (gl_account is null or length(gl_account) <= 40),
  add column gl_offset_account text check (gl_offset_account is null or length(gl_offset_account) <= 40);

create table payroll_gl_settings (
  id uuid primary key default uuidv7(),
  company_id uuid not null unique references companies (id),
  -- حساب الرواتب المستحقة (دائن بالمستحق للدفع) / salaries payable (credit for the payable amount)
  salaries_payable text check (salaries_payable is null or length(salaries_payable) <= 40),
  -- حساب سلف الموظفين (دائن بأقساط السلف المستقطعة) / employee advances (credit for deducted installments)
  loans_receivable text check (loans_receivable is null or length(loans_receivable) <= 40),
  -- مصروف افتراضي لبنود بلا حساب (مثل الراتب الأساسي) / default expense for lines without an account (e.g. basic salary)
  default_expense text check (default_expense is null or length(default_expense) <= 40),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create trigger payroll_gl_settings_updated_at before update on payroll_gl_settings
  for each row execute function set_updated_at();
alter table payroll_gl_settings enable row level security;
create policy tenant_isolation on payroll_gl_settings
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
create trigger payroll_gl_settings_audit after insert or update or delete on payroll_gl_settings
  for each row execute function audit_row_change('version', 'updated_at');

-- Down Migration
drop table payroll_gl_settings;
alter table pay_components drop column gl_offset_account, drop column gl_account;
