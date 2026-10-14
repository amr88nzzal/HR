-- Up Migration
-- 6c: قوالب DOCX (ملف Word بمتغيرات {{...}}) إلى جانب قوالب HTML.

alter table letter_templates
  add column format text not null default 'html' check (format in ('html', 'docx'));

-- إصدار القالب: نص HTML أو ملف DOCX مخزَّن (واحد منهما)
alter table letter_template_versions
  alter column body_html drop not null,
  add column docx_file_id uuid references stored_files (id),
  add constraint letter_template_versions_body_chk
    check ((body_html is not null) <> (docx_file_id is not null));

-- نسخة DOCX المملوءة للوثيقة الصادرة (إلى جانب PDF الثابت)
alter table issued_documents add column docx_file_id uuid references stored_files (id);

alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template'));

-- Down Migration
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document'));
alter table issued_documents drop column docx_file_id;
alter table letter_template_versions
  drop constraint letter_template_versions_body_chk,
  drop column docx_file_id;
delete from letter_template_versions where body_html is null;
alter table letter_template_versions alter column body_html set not null;
alter table letter_templates drop column format;
