import type { z } from 'zod';

/** يحوّل نتيجة zod إلى صيغة أخطاء @mantine/form: { اسم_الحقل: رسالة } (أول خطأ لكل حقل). */
export const zodValidate =
  <T extends z.ZodType>(schema: T) =>
  (values: unknown): Record<string, string> => {
    const r = schema.safeParse(values);
    if (r.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = String(issue.path[0] ?? '_');
      errors[key] ??= issue.message;
    }
    return errors;
  };
