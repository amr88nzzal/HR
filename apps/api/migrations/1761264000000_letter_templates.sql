-- Up Migration
-- 6a: قوالب الوثائق الصادرة (HTML) بإصداراتها، وسجل الوثائق الصادرة.

create table letter_templates (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  code text not null check (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  name_ar text not null,
  name_en text,
  -- لغة الوثيقة: تحدد لغة قيم المتغيرات (الأسماء والمسميات) واتجاه الصفحة
  language text not null check (language in ('ar', 'en')),
  category text not null default 'certificate',
  active_version_id uuid,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create trigger letter_templates_updated_at before update on letter_templates
  for each row execute function set_updated_at();

create table letter_template_versions (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  template_id uuid not null references letter_templates (id) on delete cascade,
  version_no integer not null,
  body_html text not null,
  content_hash text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  note text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (template_id, version_no)
);
create index letter_template_versions_tpl_idx on letter_template_versions (template_id, version_no desc);
alter table letter_templates add constraint letter_templates_active_fk
  foreign key (active_version_id) references letter_template_versions (id);

create table issued_documents (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id),
  template_id uuid not null references letter_templates (id),
  template_version_id uuid not null references letter_template_versions (id),
  language text not null check (language in ('ar', 'en')),
  title text not null,
  -- لقطة القيم وقت الإصدار (للتدقيق، وإعادة التوليد المطابقة)
  data jsonb not null default '{}',
  -- بصمة القالب وقت الإصدار
  template_hash text not null,
  file_id uuid references stored_files (id),
  issued_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index issued_documents_emp_idx on issued_documents (company_id, employee_id, created_at desc);
create index issued_documents_created_idx on issued_documents (company_id, created_at desc);

-- ملفات الوثائق الصادرة تُخزَّن في stored_files
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document'));

do $$
declare t text;
begin
  foreach t in array array['letter_templates', 'letter_template_versions', 'issued_documents']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  create trigger letter_templates_audit after insert or update or delete on letter_templates
    for each row execute function audit_row_change('version', 'updated_at');
  create trigger issued_documents_audit after insert or update or delete on issued_documents
    for each row execute function audit_row_change('version', 'updated_at');
end $$;

-- Down Migration
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo'));
drop table issued_documents;
alter table letter_templates drop constraint letter_templates_active_fk;
drop table letter_template_versions, letter_templates;
