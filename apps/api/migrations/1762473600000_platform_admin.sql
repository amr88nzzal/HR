-- Up Migration
-- إدارة الشركات على مستوى المنصة. التطبيق يعمل بدور hrms_app الخاضع لـ RLS، فلا يرى إلا شركته؛
-- لذلك نعرّض ثلاث دوال SECURITY DEFINER ضيقة بدل منح التطبيق اتصال المالك.
-- Platform-level company management. The app runs as the RLS-bound hrms_app role and sees only
-- its own company, so we expose three narrow SECURITY DEFINER functions instead of an owner connection.

create function platform_list_companies()
returns table (
  id uuid, slug citext, name_ar text, name_en text, timezone text, default_locale text,
  status text, version integer, created_at timestamptz, user_count integer, employee_count integer
)
language sql stable security definer set search_path = public as $$
  select c.id, c.slug, c.name_ar, c.name_en, c.timezone, c.default_locale, c.status, c.version,
         c.created_at,
         (select count(*)::int from users u where u.company_id = c.id),
         (select count(*)::int from employees e where e.company_id = c.id)
    from companies c
   order by c.created_at, c.slug
$$;

create function platform_create_company(
  p_slug text, p_name_ar text, p_name_en text, p_timezone text, p_locale text
) returns uuid
language sql security definer set search_path = public as $$
  insert into companies (slug, name_ar, name_en, timezone, default_locale)
  values (p_slug::citext, p_name_ar, p_name_en, p_timezone, p_locale)
  returning id
$$;

-- يرجع الإصدار الجديد، أو لا شيء إن تعارض الإصدار (قفل تفاؤلي) أو لم توجد الشركة
-- Returns the new version, or nothing on a version conflict (optimistic lock) or unknown company
create function platform_update_company(
  p_id uuid, p_name_ar text, p_name_en text, p_status text, p_timezone text, p_locale text,
  p_version integer
) returns integer
language sql security definer set search_path = public as $$
  update companies
     set name_ar = p_name_ar, name_en = p_name_en, status = p_status,
         timezone = p_timezone, default_locale = p_locale, version = version + 1
   where id = p_id and version = p_version
  returning version
$$;

revoke all on function platform_list_companies() from public;
revoke all on function platform_create_company(text, text, text, text, text) from public;
revoke all on function platform_update_company(uuid, text, text, text, text, text, integer) from public;
grant execute on function platform_list_companies() to hrms_app;
grant execute on function platform_create_company(text, text, text, text, text) to hrms_app;
grant execute on function platform_update_company(uuid, text, text, text, text, text, integer) to hrms_app;

-- Down Migration
drop function platform_update_company(uuid, text, text, text, text, text, integer);
drop function platform_create_company(text, text, text, text, text);
drop function platform_list_companies();
