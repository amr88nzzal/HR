/** نسخة من الكائن بلا المفاتيح المذكورة (بدل التفكيك بمتغيرات غير مستخدمة). */
export const omit = <T extends Record<string, unknown>>(
  obj: T,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
