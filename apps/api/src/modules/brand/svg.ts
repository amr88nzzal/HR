/** فحص صارم لشعار SVG قبل تحويله إلى PNG: لا سكربت ولا موارد خارجية ولا كيانات. يعيد المشكلات. */
export const looksLikeSvg = (buf: Buffer): boolean => {
  const head = buf
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  return head.startsWith('<') && /<svg[\s>/]/i.test(head);
};

const FORBIDDEN: [RegExp, string][] = [
  [/<\s*script/i, 'ممنوع وسم script'],
  [/<\s*foreignObject/i, 'ممنوع وسم foreignObject'],
  [/<\s*(iframe|object|embed|audio|video|animate|set|use)\b/i, 'ممنوع وسوم التضمين والحركة'],
  [/\son[a-z]+\s*=/i, 'ممنوع معالجات الأحداث'],
  [/javascript\s*:/i, 'ممنوع روابط javascript'],
  [/<!ENTITY/i, 'ممنوعة تعريفات الكيانات'],
  [/<!DOCTYPE[^>]*\[/i, 'ممنوع DOCTYPE بتعريفات داخلية'],
  [/@import\b/i, 'ممنوع @import'],
  [
    /(xlink:)?href\s*=\s*["']\s*(?!data:image\/(png|jpeg);base64,|#)/i,
    'ممنوعة الروابط والموارد الخارجية',
  ],
  [/url\(\s*["']?\s*(?!#)/i, 'ممنوع url() خارج المراجع الداخلية'],
];

export const checkSvg = (buf: Buffer): string[] => {
  const text = buf.toString('utf8');
  return FORBIDDEN.filter(([re]) => re.test(text)).map(([, msg]) => msg);
};
