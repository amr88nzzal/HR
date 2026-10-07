-- Up Migration
-- الأرشيف العام للوثائق (موظف / فرع / شركة) بحقول ديناميكية، والملفات المخزَّنة

-- ملف مخزَّن (البايتات خارج القاعدة عبر StorageProvider)
create table stored_files (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  storage_key text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  is_encrypted boolean not null default false,
  purpose text not null check (purpose in ('document', 'employee_photo')),
  -- نسخة مشتقة (مصغّرة الصورة مثلاً) تتبع الملف الأصلي
  parent_id uuid references stored_files (id) on delete cascade,
  variant text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index stored_files_parent_idx on stored_files (parent_id);

create table document_types (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  -- مفتاح ثابت لما يعتمد عليه الكود (لا يُحذف النوع ولا يُغيَّر مفتاحه)
  system_key text check (system_key is null or system_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_ar text not null,
  name_en text,
  category text,
  owner_type text not null check (owner_type in ('employee', 'branch', 'company')),
  is_required boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index document_types_system_key_uidx on document_types (company_id, system_key)
  where system_key is not null;

create table document_type_fields (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  document_type_id uuid not null,
  key text not null check (key ~ '^[a-z][a-zA-Z0-9]{0,39}$'),
  label_ar text not null,
  label_en text,
  data_type text not null check (data_type in
    ('text', 'long_text', 'number', 'date', 'amount', 'boolean', 'select', 'file', 'reminder_date')),
  is_required boolean not null default false,
  -- حساس: يُشفَّر ويُقنَّع ويُكشف بصلاحية مدقَّقة
  is_sensitive boolean not null default false,
  -- فريد ضمن النوع (بين الوثائق النشطة)
  is_unique boolean not null default false,
  -- خيارات القائمة [{value,labelAr,labelEn?}] أو قواعد التحقق {min,max,regex}
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  show_in_list boolean not null default false,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, document_type_id) references document_types (company_id, id) on delete cascade,
  unique (document_type_id, key),
  check (not (is_sensitive and is_unique))
);

create table documents (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  document_type_id uuid not null,
  -- مالك الوثيقة: معرّف الموظف أو الفرع أو الشركة (حسب owner_type للنوع)
  owner_type text not null check (owner_type in ('employee', 'branch', 'company')),
  owner_id uuid not null,
  "values" jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'superseded')),
  version_no integer not null default 1,
  superseded_at timestamptz,
  superseded_by uuid references documents (id),
  created_by uuid references users (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, document_type_id) references document_types (company_id, id),
  unique (company_id, id)
);
create index documents_owner_idx on documents (owner_type, owner_id, document_type_id);
create index documents_values_gin on documents using gin ("values" jsonb_path_ops);

create table document_files (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  document_id uuid not null,
  file_id uuid not null,
  -- مفتاح حقل الملف في النوع (اختياري)
  field_key text,
  page_no integer not null default 1 check (page_no >= 1),
  created_at timestamptz not null default now(),
  foreign key (company_id, document_id) references documents (company_id, id) on delete cascade,
  foreign key (company_id, file_id) references stored_files (company_id, id),
  unique (file_id)
);
create index document_files_doc_idx on document_files (document_id);

create table document_reminders (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  document_id uuid not null,
  field_key text not null,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, document_id) references documents (company_id, id) on delete cascade,
  unique (document_id, field_key)
);
create index document_reminders_due_idx on document_reminders (due_date) where status = 'pending';

alter table employees add constraint employees_photo_file_fk
  foreign key (company_id, photo_file_id) references stored_files (company_id, id);
alter table contracts add constraint contracts_file_fk
  foreign key (company_id, file_id) references stored_files (company_id, id);

-- المالك متعدد الأشكال بلا مفتاح أجنبي: يُمنع حذف موظف/فرع له وثائق (23503 ← IN_USE)
create function prevent_delete_owner_with_documents() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from documents where owner_type = tg_argv[0] and owner_id = old.id) then
    raise foreign_key_violation using message = 'owner has documents';
  end if;
  return old;
end $$;
create trigger employees_documents_guard before delete on employees
  for each row execute function prevent_delete_owner_with_documents('employee');
create trigger branches_documents_guard before delete on branches
  for each row execute function prevent_delete_owner_with_documents('branch');

do $$
declare t text;
begin
  foreach t in array array['stored_files', 'document_types', 'document_type_fields', 'documents',
                           'document_files', 'document_reminders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;
  foreach t in array array['document_types', 'document_type_fields', 'documents', 'document_reminders'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'')', t || '_audit', t);
  end loop;
  create trigger document_files_audit after insert or update or delete on document_files
    for each row execute function audit_row_change('version', 'updated_at');
end $$;

-- Down Migration
drop trigger branches_documents_guard on branches;
drop trigger employees_documents_guard on employees;
drop function prevent_delete_owner_with_documents();
alter table contracts drop constraint contracts_file_fk;
alter table employees drop constraint employees_photo_file_fk;
drop table document_reminders;
drop table document_files;
drop table documents;
drop table document_type_fields;
drop table document_types;
drop table stored_files;
