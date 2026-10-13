import { AppError } from '../../shared/errors.js';

/** يحوّل صفحة HTML كاملة إلى PDF (حاوية render منفصلة، وتُستبدل في الاختبار). */
export type Renderer = (html: string) => Promise<Buffer>;

export const createHttpRenderer = (baseUrl: string): Renderer => {
  const url = `${baseUrl.replace(/\/$/, '')}/pdf`;
  return async (html) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AppError('RENDER_UNAVAILABLE', 503, 'خدمة تحويل PDF غير متاحة حالياً');
    }
    if (!res.ok) throw new AppError('RENDER_FAILED', 502, 'تعذّر توليد ملف PDF');
    return Buffer.from(await res.arrayBuffer());
  };
};
