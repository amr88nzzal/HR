-- Up Migration
-- U: سبب تعطيل الحساب: التعطيل التلقائي عند إنهاء الخدمة يُرفع تلقائياً عند العودة (والتعطيل اليدوي لا يُمَس).
-- دعوات التفعيل تستعمل جدول password_resets القائم (رابط لمرة واحدة بصلاحية محدودة).
alter table users add column disabled_reason text
  check (disabled_reason is null or disabled_reason in ('employment_ended'));

-- Down Migration
alter table users drop column disabled_reason;
