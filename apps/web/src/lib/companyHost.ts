// استخراج رمز الشركة من اسم المضيف حسب قالب مسطّح: {company}-hr.amrodev.com ← acme
// (لا نطاق فرعي داخل نطاق فرعي، لأن شهادة/DNS النطاق العام لا يغطيان إلا مستوى واحداً)
// Extract the company code from the hostname using a flat pattern: {company}-hr.amrodev.com -> acme
// (no nested subdomains: wildcard DNS/certs only cover a single level)
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

export const companyFromHost = (hostname: string, pattern: string): string | undefined => {
  if (!pattern.includes('{company}')) return undefined;
  const escaped = pattern
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{company\\}', `(${LABEL})`);
  const m = new RegExp(`^${escaped}$`).exec(hostname.toLowerCase());
  return m?.[1];
};

// القالب يُحدَّد عند البناء بـ VITE_COMPANY_HOST_PATTERN / pattern is set at build time
export const COMPANY_HOST_PATTERN: string =
  (import.meta.env['VITE_COMPANY_HOST_PATTERN'] as string | undefined) ??
  '{company}-hr.amrodev.com';
