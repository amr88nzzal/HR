import { AppError } from '../../shared/errors.js';

/** يحوّل صفحة HTML كاملة إلى PDF (حاوية render منفصلة، وتُستبدل في الاختبار). */
export type Renderer = ((html: string) => Promise<Buffer>) & {
  /** تحويل DOCX إلى PDF (LibreOffice في الحاوية نفسها)؛ غيابه يعطّل قوالب DOCX فقط */
  docxToPdf?: (docx: Buffer) => Promise<Buffer>;
};

const post = async (url: string, init: RequestInit): Promise<Buffer> => {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(90_000) });
  } catch {
    throw new AppError('RENDER_UNAVAILABLE', 503, 'خدمة تحويل PDF غير متاحة حالياً');
  }
  if (!res.ok) throw new AppError('RENDER_FAILED', 502, 'تعذّر توليد ملف PDF');
  return Buffer.from(await res.arrayBuffer());
};

export const createHttpRenderer = (baseUrl: string): Renderer => {
  const base = baseUrl.replace(/\/$/, '');
  const r: Renderer = (html) =>
    post(`${base}/pdf`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
    });
  r.docxToPdf = (docx) =>
    post(`${base}/docx-pdf`, {
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(docx),
    });
  return r;
};
