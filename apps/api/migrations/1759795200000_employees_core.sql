-- Up Migration
-- بطاقة الموظف: الأساس والجداول الفرعية، وترقيم متسلسل عام

create extension if not exists pg_trgm;

-- تسلسلات ترقيم (الرقم الوظيفي الآن، وأرقام المستندات الصادرة لاحقاً)
create table numbering_sequences (
  company_id uuid not null references companies (id),
  key text not null,
  next_value bigint not null default 1,
  primary key (company_id, key)
);

create table employees (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_no text not null,
  first_name_ar text not null,
  father_name_ar text,
  grandfather_name_ar text,
  family_name_ar text not null,
  first_name_en text,
  father_name_en text,
  grandfather_name_en text,
  family_name_en text,
  full_name_ar text not null,
  full_name_en text,
  search_text text not null default '',
  birth_date date,
  gender text check (gender in ('male', 'female')),
  marital_status text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  nationality text check (nationality ~ '^[A-Z]{2}$'),
  photo_file_id uuid,
  status text not null default 'active' check (status in ('active', 'suspended', 'terminated')),
  first_hire_date date,
  user_id uuid unique references users (id),
  custom_fields jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_no)
);
create index employees_search_trgm on employees using gin (search_text gin_trgm_ops);
create index employees_status_idx on employees (company_id, status);

create table employee_contacts (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  type text not null check (type in ('mobile', 'phone', 'email', 'emergency')),
  value text not null,
  contact_name text,
  relation text,
  is_primary boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_contacts_emp_idx on employee_contacts (employee_id);
create unique index employee_contacts_primary on employee_contacts (employee_id, type) where is_primary;

create table employee_addresses (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  type text not null default 'home' check (type in ('home', 'work', 'other')),
  country text,
  city text,
  line1 text,
  line2 text,
  postal_code text,
  is_primary boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_addresses_emp_idx on employee_addresses (employee_id);
create unique index employee_addresses_primary on employee_addresses (employee_id) where is_primary;

create table employee_dependents (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  name text not null,
  relation text not null check (relation in ('spouse', 'child', 'parent', 'other')),
  birth_date date,
  gender text check (gender in ('male', 'female')),
  is_covered boolean not null default false,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_dependents_emp_idx on employee_dependents (employee_id);

-- IBAN مشفّر (AES-256-GCM في التطبيق؛ المفتاح ضمن الحمولة)، مع بصمة HMAC للبحث وقناع للعرض
create table employee_bank_accounts (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  bank_name text not null,
  account_holder text,
  iban_enc text not null,
  iban_digest text not null,
  iban_masked text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  is_primary boolean not null default false,
  valid_from date,
  valid_to date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index employee_bank_accounts_emp_idx on employee_bank_accounts (employee_id);
create index employee_bank_accounts_digest_idx on employee_bank_accounts (company_id, iban_digest);
create unique index employee_bank_accounts_primary on employee_bank_accounts (employee_id) where is_primary and valid_to is null;

create table employee_education (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  degree text not null,
  field text,
  institution text,
  country text,
  start_year smallint,
  end_year smallint,
  grade text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_year is null or start_year is null or end_year >= start_year)
);
create index employee_education_emp_idx on employee_education (employee_id);

create table employee_experience (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  employee_id uuid not null references employees (id) on delete cascade,
  employer text not null,
  title text,
  start_date date,
  end_date date,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index employee_experience_emp_idx on employee_experience (employee_id);

do $$
declare t text;
begin
  foreach t in array array['employees', 'employee_contacts', 'employee_addresses', 'employee_dependents',
                           'employee_bank_accounts', 'employee_education', 'employee_experience'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (company_id = nullif(current_setting(''app.company_id'', true), '''')::uuid)', t);
  end loop;

  foreach t in array array['employees', 'employee_contacts', 'employee_addresses', 'employee_dependents',
                           'employee_education', 'employee_experience'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row_change(''version'', ''updated_at'', ''search_text'')', t || '_audit', t);
  end loop;
  -- لا يُسجَّل المشفّر ولا البصمة في التدقيق
  create trigger employee_bank_accounts_audit after insert or update or delete on employee_bank_accounts
    for each row execute function audit_row_change('version', 'updated_at', 'iban_enc', 'iban_digest');

  alter table numbering_sequences enable row level security;
  create policy tenant_isolation on numbering_sequences
    using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
end $$;

-- Down Migration
drop table employee_experience, employee_education, employee_bank_accounts, employee_dependents,
  employee_addresses, employee_contacts, employees, numbering_sequences;
