-- Up Migration
-- مرفقات طلب الإجازة (تقرير طبي مثلاً): ملف مشفّر في stored_files مرتبط بالطلب.
-- Leave request attachments (e.g. a medical report): an encrypted stored file linked to the request.
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report', 'admin_action', 'leave_request'));

create table leave_request_attachments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  request_id uuid not null references leave_requests (id) on delete cascade,
  file_id uuid not null references stored_files (id),
  uploaded_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index leave_request_attachments_req_idx on leave_request_attachments (company_id, request_id);
create trigger leave_request_attachments_audit after insert or update or delete on leave_request_attachments
  for each row execute function audit_row_change('version', 'updated_at');
alter table leave_request_attachments enable row level security;
create policy tenant_isolation on leave_request_attachments
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table leave_request_attachments;
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report', 'admin_action'));
