-- Up Migration
-- إبطال كل جلسات شركة (توكنات التحديث) عند تعليقها؛ security definer لتجاوز RLS لأن المنصّة لا تعمل داخل مستأجر
-- Revoke all of a company's sessions (refresh tokens) when it is suspended; security definer to bypass RLS since the platform runs outside a tenant
create function platform_revoke_company_sessions(p_company_id uuid) returns integer
language sql security definer set search_path = public as $$
  with r as (
    update refresh_tokens set revoked_at = now()
     where company_id = p_company_id and revoked_at is null
    returning 1
  ) select count(*)::int from r
$$;
revoke all on function platform_revoke_company_sessions(uuid) from public;
grant execute on function platform_revoke_company_sessions(uuid) to hrms_app;

-- Down Migration
drop function platform_revoke_company_sessions(uuid);
