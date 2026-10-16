import { z } from 'zod';

/** خانات الصور: شعار لكل لغة، نسخة للخلفية الداكنة، وختم/توقيع اختياري. */
export const BRAND_SLOTS = ['logo_ar', 'logo_en', 'logo_dark_ar', 'logo_dark_en', 'stamp'] as const;
export type BrandSlot = (typeof BRAND_SLOTS)[number];
export const MAX_BRAND_IMAGE_BYTES = 1_000_000;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const brandTextInput = z.object({
  legalNameAr: text(200),
  legalNameEn: text(200),
  addressAr: text(400),
  addressEn: text(400),
  footerAr: text(600),
  footerEn: text(600),
  phone: text(60),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v), 'بريد غير صالح'),
  website: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^https?:\/\/[^\s"'<>]+$/i.test(v),
      'الموقع يبدأ بـ http:// أو https://',
    ),
  taxNo: text(60),
  registrationNo: text(60),
});
export type BrandText = z.infer<typeof brandTextInput>;
export const brandUpdateInput = brandTextInput.extend({ version: z.number().int().optional() });

export const brandPreviewInput = z.object({
  lang: z.enum(['ar', 'en']),
  fields: brandTextInput.partial().optional(),
});

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const ltr = (s: string): string => `<span dir="ltr" style="unicode-bidi:isolate">${esc(s)}</span>`;
const lines = (s: string): string => esc(s).replace(/\r?\n/g, '<br>');

/** القيمة بلغة الوثيقة مع الرجوع للغة الأخرى عند غيابها. */
export const brandPick = (
  b: BrandText,
  lang: 'ar' | 'en',
  key: 'legalName' | 'address' | 'footer',
) => {
  const ar = b[`${key}Ar`];
  const en = b[`${key}En`];
  return (lang === 'en' ? en || ar : ar || en) || null;
};

/** نص الشركة بلغة الوثيقة (متغيرات نصية بسيطة صالحة لـ HTML وDOCX). */
export const brandTextValues = (
  b: BrandText,
  lang: 'ar' | 'en',
): Record<string, string | null> => ({
  'company.legalName': brandPick(b, lang, 'legalName'),
  'company.address': brandPick(b, lang, 'address'),
  'company.phone': b.phone,
  'company.email': b.email,
  'company.website': b.website,
  'company.taxNo': b.taxNo,
  'company.registrationNo': b.registrationNo,
});

/**
 * كتلة الترويسة (HTML جاهز بأنماط مضمّنة؛ كل نص مهروب). تُولَّد في الخادم فقط.
 * logo: data URL لـ PNG أو null.
 */
export const buildLetterheadHtml = (
  b: BrandText,
  lang: 'ar' | 'en',
  logo: string | null,
  companyFallbackName: string | null,
): string => {
  const ar = lang === 'ar';
  const name = brandPick(b, lang, 'legalName') ?? companyFallbackName;
  const address = brandPick(b, lang, 'address');
  const contacts = [b.phone, b.email, b.website].filter((x): x is string => !!x).map(ltr);
  const ids = [
    b.taxNo ? `${ar ? 'الرقم الضريبي' : 'Tax No.'}: ${ltr(b.taxNo)}` : null,
    b.registrationNo ? `${ar ? 'السجل التجاري' : 'Reg. No.'}: ${ltr(b.registrationNo)}` : null,
  ].filter((x): x is string => !!x);
  const img =
    logo && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo)
      ? `<img src="${logo}" alt="" style="max-height:70px;max-width:220px;display:block">`
      : '';
  const textBlock = [
    name ? `<div style="font-weight:bold;font-size:16pt">${esc(name)}</div>` : '',
    address ? `<div>${lines(address)}</div>` : '',
    contacts.length ? `<div>${contacts.join(' · ')}</div>` : '',
    ids.length ? `<div>${ids.join(' · ')}</div>` : '',
  ].join('');
  if (!img && !textBlock) return '';
  return `<div class="lh-header" dir="${ar ? 'rtl' : 'ltr'}" style="display:flex;align-items:center;gap:16px;padding-bottom:8px;margin-bottom:14px;border-bottom:2px solid #444;font-size:10.5pt;line-height:1.5">${img}<div style="flex:1">${textBlock}</div></div>`;
};

export const buildFooterHtml = (b: BrandText, lang: 'ar' | 'en'): string => {
  const f = brandPick(b, lang, 'footer');
  return f
    ? `<div class="lh-footer" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="text-align:center;font-size:9pt;color:#444;border-top:1px solid #999;padding-top:4px">${lines(f)}</div>`
    : '';
};
