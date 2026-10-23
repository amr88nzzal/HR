import { api } from '../../api/client';
import { downloadBlob } from '../../lib/export';

/**
 * يجلب PDF قسيمة (HR) ثم يفتحه للطباعة أو يحمّله.
 * Fetches a payslip PDF (HR route) then opens it for printing or downloads it.
 */
export const fetchSlipPdf = (id: string, lang: string): Promise<Blob> =>
  api.blob(`/payroll/payslips/${id}/pdf`, { lang });

export const printSlip = async (id: string, lang: string): Promise<void> => {
  const blob = await fetchSlipPdf(id, lang);
  const url = URL.createObjectURL(blob);
  // نافذة جديدة يفتح فيها عارض PDF؛ المستخدم يطبع منه (الطباعة التلقائية غير موثوقة عبر المتصفحات)
  // New tab with the PDF viewer; the user prints from there (auto-print is unreliable across browsers)
  const w = window.open(url, '_blank');
  if (!w) downloadBlob(blob, 'payslip.pdf');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const downloadSlip = async (id: string, lang: string, name: string): Promise<void> =>
  downloadBlob(await fetchSlipPdf(id, lang), name);
