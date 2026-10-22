-- Up Migration
-- التحقق العام من قسيمة راتب برمز QR: بلا جلسة، يعيد الحد الأدنى فقط (والمبالغ للمقارنة داخل الخادم لا للعرض).
-- Public payslip verification via QR: no session, minimal columns (amounts are only compared server-side, never shown).
create function verify_payslip(p_id uuid)
returns table (
  company_id uuid,
  company_name_ar text,
  company_name_en text,
  default_locale text,
  employee_name_ar text,
  employee_name_en text,
  year int,
  month int,
  gross text,
  deductions text,
  net text,
  loans text,
  payable text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.company_id, c.name_ar, c.name_en, c.default_locale, e.full_name_ar, e.full_name_en,
         p.year, p.month, s.gross_amount::text, s.deductions_amount::text, s.net_amount::text,
         s.loans_amount::text, s.payable_amount::text
    from payslips s
    join payroll_periods p on p.id = s.period_id
    join employees e on e.id = s.employee_id
    join companies c on c.id = s.company_id
   where s.id = p_id and s.status = 'calculated'
$$;
grant execute on function verify_payslip(uuid) to hrms_app;

-- Down Migration
drop function verify_payslip(uuid);
