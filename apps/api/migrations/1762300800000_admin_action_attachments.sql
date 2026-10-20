-- Up Migration
-- مرفقات الإجراءات الإدارية (قرار موقّع، إفادة…) على مخزن الملفات المشترك
-- Attachments of administrative actions (signed decision, statement…) on the shared file store
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report', 'admin_action'));

create table admin_action_attachments (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  action_id uuid not null references admin_actions (id) on delete cascade,
  file_id uuid not null references stored_files (id),
  uploaded_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index admin_action_attachments_action_idx on admin_action_attachments (company_id, action_id);

create trigger admin_action_attachments_audit after insert or update or delete on admin_action_attachments
  for each row execute function audit_row_change('version', 'updated_at');
alter table admin_action_attachments enable row level security;
create policy tenant_isolation on admin_action_attachments
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table admin_action_attachments;
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand', 'report'));
