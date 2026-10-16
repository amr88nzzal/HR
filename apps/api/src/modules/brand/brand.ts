import { sql } from 'kysely';
import {
  brandTextValues,
  buildFooterHtml,
  buildLetterheadHtml,
  type BrandSlot,
  type BrandText,
} from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { readStoredFile, type FileDeps } from '../../shared/stored-files.js';

export const SLOT_COLUMN = {
  logo_ar: 'logoArFileId',
  logo_en: 'logoEnFileId',
  logo_dark_ar: 'logoDarkArFileId',
  logo_dark_en: 'logoDarkEnFileId',
  stamp: 'stampFileId',
} as const satisfies Record<BrandSlot, string>;

const TEXT_KEYS = [
  'legalNameAr',
  'legalNameEn',
  'addressAr',
  'addressEn',
  'footerAr',
  'footerEn',
  'phone',
  'email',
  'website',
  'taxNo',
  'registrationNo',
] as const;

export const emptyBrandText = (): BrandText =>
  Object.fromEntries(TEXT_KEYS.map((k) => [k, null])) as unknown as BrandText;

export type BrandRow = BrandText & {
  version: number;
  files: Record<BrandSlot, string | null>;
};

export const loadBrand = async (ctx: Ctx): Promise<BrandRow | null> => {
  const r = await ctx.trx
    .selectFrom('companyBrand')
    .selectAll()
    .where('companyId', '=', ctx.companyId)
    .executeTakeFirst();
  if (!r) return null;
  const text = Object.fromEntries(TEXT_KEYS.map((k) => [k, r[k]])) as unknown as BrandText;
  return {
    ...text,
    version: r.version,
    files: {
      logo_ar: r.logoArFileId,
      logo_en: r.logoEnFileId,
      logo_dark_ar: r.logoDarkArFileId,
      logo_dark_en: r.logoDarkEnFileId,
      stamp: r.stampFileId,
    },
  };
};

/** صورة الخانة كبايتات PNG (أو null). */
export const loadSlotImage = async (
  ctx: Ctx,
  deps: FileDeps,
  fileId: string | null,
): Promise<{ bytes: Buffer; mime: string; sha256: string } | null> => {
  if (!fileId) return null;
  const f = await ctx.trx
    .selectFrom('storedFiles')
    .selectAll()
    .where('id', '=', fileId)
    .executeTakeFirst();
  if (!f) return null;
  return { bytes: await readStoredFile(deps, f), mime: f.mimeType, sha256: f.sha256 };
};

const dataUrl = (img: { bytes: Buffer } | null): string | null =>
  img ? `data:image/png;base64,${img.bytes.toString('base64')}` : null;

export type Letterhead = {
  values: Record<string, string | null>;
  header: string;
  footer: string;
};

/**
 * قيم الهوية البصرية لوثيقة بلغة معيّنة: نصوص بسيطة (HTML وDOCX) وصور وكتل جاهزة (HTML فقط).
 * `override` لمعاينة نصوص لم تُحفظ بعد.
 */
export const loadLetterhead = async (
  ctx: Ctx,
  deps: FileDeps,
  lang: 'ar' | 'en',
  override?: Partial<BrandText>,
): Promise<Letterhead> => {
  const brand = await loadBrand(ctx);
  const text: BrandText = { ...(brand ?? emptyBrandText()), ...(override ?? {}) };
  const company = await sql<{ nameAr: string; nameEn: string | null }>`
    select name_ar, name_en from companies where id = ${ctx.companyId}`.execute(ctx.trx);
  const co = company.rows[0];
  const fallback = lang === 'en' ? (co?.nameEn ?? co?.nameAr ?? null) : (co?.nameAr ?? null);
  const logoId =
    brand?.files[lang === 'en' ? 'logo_en' : 'logo_ar'] ??
    brand?.files[lang === 'en' ? 'logo_ar' : 'logo_en'] ??
    null;
  const logo = dataUrl(await loadSlotImage(ctx, deps, logoId));
  const stamp = dataUrl(await loadSlotImage(ctx, deps, brand?.files.stamp ?? null));
  const header = buildLetterheadHtml(text, lang, logo, fallback);
  const footer = buildFooterHtml(text, lang);
  return {
    header,
    footer,
    values: {
      ...brandTextValues(text, lang),
      'company.logo': logo,
      'company.stamp': stamp,
      'company.header': header || null,
      'company.footer': footer || null,
    },
  };
};
