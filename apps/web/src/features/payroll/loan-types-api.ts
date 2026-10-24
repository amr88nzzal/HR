import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export type LoanType = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  color: string;
  disburses: boolean;
  requiresAttachment: boolean;
  maxInstallments: number;
  monthlyLimitPercent: string | null;
  glAccount: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
};

/** أنواع السلف الفعّالة (للاختيار عند إنشاء سلفة/فاتورة). / Active loan types, for pickers. */
export const useLoanTypes = (enabled = true) =>
  useQuery({
    queryKey: ['/payroll', 'loan-types'],
    enabled,
    queryFn: async () =>
      (await api.get<LoanType[]>('/payroll/loan-types', { pageSize: 100 })).data.filter(
        (t) => t.isActive,
      ),
  });

export const typeName = (
  r: { typeNameAr?: string; typeNameEn?: string } | undefined,
  lang: string,
): string | undefined => (lang === 'en' ? r?.typeNameEn || r?.typeNameAr : r?.typeNameAr);
