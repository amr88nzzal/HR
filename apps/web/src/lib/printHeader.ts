import { api } from '../api/client';
import type { PrintHeader } from './tableTools';

type HeaderDto = {
  nameAr: string;
  nameEn: string;
  addressAr: string | null;
  addressEn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * ترويسة الطباعة من الهوية البصرية للشركة (شعار واسم وعنوان وتواصل) بلغة الواجهة.
 * أي فشل (لا شعار، لا صلاحية، انقطاع) لا يمنع الطباعة؛ تعود الدالة بما توفّر أو null.
 */
export const loadPrintHeader = async (lang: string): Promise<PrintHeader | null> => {
  const l = lang === 'en' ? 'en' : 'ar';
  const [info, logo] = await Promise.all([
    api.get<HeaderDto>('/company-brand/print-header').then(
      (r) => r.data,
      () => null,
    ),
    api.blob('/company-brand/logo', { lang: l, theme: 'light' }).then(
      (b) => toDataUrl(b),
      () => null,
    ),
  ]);
  if (!info && !logo) return null;
  return {
    name: info ? (l === 'en' ? info.nameEn : info.nameAr) : '',
    lines: info
      ? [l === 'en' ? info.addressEn : info.addressAr, info.phone, info.email, info.website].filter(
          (x): x is string => !!x,
        )
      : [],
    logo,
  };
};
