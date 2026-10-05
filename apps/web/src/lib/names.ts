/** الاسم المعروض حسب اللغة مع رجوع للعربي. */
export const localName = (row: Record<string, unknown>, lang: string): string => {
  const ar = typeof row.nameAr === 'string' ? row.nameAr : '';
  const en = typeof row.nameEn === 'string' ? row.nameEn : '';
  return lang === 'en' ? en || ar : ar || en;
};
