-- Up Migration
-- B: الهوية البصرية للشركة (شعار وترويسة بلغتين) واستعمالها في الوثائق

alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template', 'brand'));

create table company_brand (
  company_id uuid primary key references companies (id),
  -- شعار لكل لغة ونسخة للخلفية الداكنة، وختم/توقيع اختياري (كلها PNG مُعاد ترميزه)
  logo_ar_file_id uuid references stored_files (id),
  logo_en_file_id uuid references stored_files (id),
  logo_dark_ar_file_id uuid references stored_files (id),
  logo_dark_en_file_id uuid references stored_files (id),
  stamp_file_id uuid references stored_files (id),
  legal_name_ar text,
  legal_name_en text,
  address_ar text,
  address_en text,
  footer_ar text,
  footer_en text,
  phone text,
  email text,
  website text,
  tax_no text,
  registration_no text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger company_brand_updated_at before update on company_brand
  for each row execute function set_updated_at();
create trigger company_brand_audit after insert or update or delete on company_brand
  for each row execute function audit_row_change('version', 'updated_at');
alter table company_brand enable row level security;
create policy tenant_isolation on company_brand
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- مفتاح «استخدام الترويسة» لكل قالب HTML (القوالب القائمة تبقى كما هي حتى تُفعَّل)
alter table letter_templates add column use_letterhead boolean not null default false;

-- شعار الشركة لشاشة الدخول (بلا جلسة): يعيد بيانات ملف الشعار فقط
create function public_brand_logo(p_slug text, p_slot text)
returns table (storage_key text, mime_type text, sha256 text)
language sql security definer set search_path = public as $$
  select f.storage_key, f.mime_type, f.sha256
    from companies c
    join company_brand b on b.company_id = c.id
    join stored_files f on f.id = case p_slot
      when 'logo_ar' then b.logo_ar_file_id
      when 'logo_en' then b.logo_en_file_id
      when 'logo_dark_ar' then b.logo_dark_ar_file_id
      when 'logo_dark_en' then b.logo_dark_en_file_id
    end
   where c.slug = p_slug::citext and c.status = 'active' and not f.is_encrypted
$$;
revoke all on function public_brand_logo(text, text) from public;
grant execute on function public_brand_logo(text, text) to hrms_app;

-- Down Migration
drop function public_brand_logo(text, text);
alter table letter_templates drop column use_letterhead;
drop table company_brand;
alter table stored_files drop constraint stored_files_purpose_check;
alter table stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'employee_photo', 'issued_document', 'letter_template'));
