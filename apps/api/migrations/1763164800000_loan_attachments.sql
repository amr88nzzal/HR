-- Up Migration
-- مرفقات السلف والفواتير (صورة الفاتورة أو سند): ملف مشفّر في stored_files مرتبط بالسلفة.
-- Loan/invoice attachments (an invoice image or a voucher): an encrypted stored file linked to the loan.
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report', 'admin_action', 'leave_request', 'loan'));

-- تنبيه فقط (لا منع) عند غياب المرفق لهذا النوع / a warning only (never a block) when the type has no attachment
alter table loan_types add column requires_attachment boolean not null default false;

create table loan_attachments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  loan_id uuid not null references loans (id) on delete cascade,
  file_id uuid not null references stored_files (id),
  uploaded_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index loan_attachments_loan_idx on loan_attachments (company_id, loan_id);
create trigger loan_attachments_audit after insert or update or delete on loan_attachments
  for each row execute function audit_row_change('version', 'updated_at');
alter table loan_attachments enable row level security;
create policy tenant_isolation on loan_attachments
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table loan_attachments;
alter table loan_types drop column requires_attachment;
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report', 'admin_action', 'leave_request'));
