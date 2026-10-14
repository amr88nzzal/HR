-- Up Migration
-- 6b: رقم الوثيقة ورمز تحقق عام وإبطال الوثائق.

-- التسلسل في numbering_sequences الموجود (المفتاح letter:<رمز القالب>:<السنة>)

alter table issued_documents
  add column doc_number text,
  add column verify_token text,
  add column revoked_at timestamptz,
  add column revoked_by uuid references users (id),
  add column revoke_reason text;
create unique index issued_documents_number_uq on issued_documents (company_id, doc_number)
  where doc_number is not null;
create unique index issued_documents_token_uq on issued_documents (verify_token)
  where verify_token is not null;

-- التحقق العام بلا جلسة: يتجاوز RLS برمز عشوائي طويل لا يمكن تخمينه، ويعيد الحد الأدنى فقط.
create function verify_issued_document(p_token text)
returns table (
  doc_number text,
  language text,
  template_name_ar text,
  template_name_en text,
  employee_name_ar text,
  employee_name_en text,
  company_name_ar text,
  company_name_en text,
  issued_at timestamptz,
  revoked_at timestamptz,
  file_sha256 text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.doc_number, d.language, t.name_ar, t.name_en, e.full_name_ar, e.full_name_en,
         c.name_ar, c.name_en, d.created_at, d.revoked_at, f.sha256
    from issued_documents d
    join letter_templates t on t.id = d.template_id
    join employees e on e.id = d.employee_id
    join companies c on c.id = d.company_id
    left join stored_files f on f.id = d.file_id
   where d.verify_token = p_token
$$;

-- Down Migration
drop function verify_issued_document(text);
alter table issued_documents
  drop column revoke_reason, drop column revoked_by, drop column revoked_at,
  drop column verify_token, drop column doc_number;
