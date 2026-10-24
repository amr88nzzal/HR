-- Up Migration
-- رموز OTP للتحقق العام من قسيمة راتب (ترسَل لتلغرام/بريد الموظف)؛ تُخزَّن مجزّأة وبصلاحية قصيرة واستعمال واحد
-- OTP codes for public payslip verification (sent to the employee's Telegram/email); stored hashed, short-lived, single use
create table payslip_verify_otps (
  id uuid primary key default uuidv7(),
  company_id uuid not null references companies (id),
  payslip_id uuid not null references payslips (id) on delete cascade,
  channel text not null check (channel in ('telegram', 'email')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index payslip_verify_otps_slip_idx on payslip_verify_otps (payslip_id, created_at desc);
alter table payslip_verify_otps enable row level security;
create policy tenant_isolation on payslip_verify_otps
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Down Migration
drop table payslip_verify_otps;
