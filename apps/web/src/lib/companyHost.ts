// استخراج رمز الشركة من النطاق الفرعي: acme.hr.amrodev.com ← acme
// Extract the company code from the subdomain: acme.hr.amrodev.com -> acme
export const companyFromHost = (hostname: string, baseDomain: string): string | undefined => {
  const host = hostname.toLowerCase();
  const base = baseDomain.toLowerCase().replace(/^\./, '');
  if (!base || !host.endsWith(`.${base}`)) return undefined;
  const prefix = host.slice(0, -(base.length + 1));
  // نقبل تسمية واحدة صالحة فقط (لا نقاط) / accept a single valid label only (no dots)
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix) ? prefix : undefined;
};

// النطاق الأساسي يُحدَّد عند البناء بـ VITE_BASE_DOMAIN / base domain is set at build time
export const BASE_DOMAIN: string =
  (import.meta.env['VITE_BASE_DOMAIN'] as string | undefined) ?? 'hr.amrodev.com';
