export type LoanRow = {
  id: string;
  employeeId: string;
  employeeNo: string | null;
  employeeName: string;
  kind: 'loan' | 'advance';
  currency: string;
  principal: string;
  installmentsCount: number;
  firstYear: number;
  firstMonth: number;
  status: 'active' | 'settled' | 'cancelled';
  repaid: string;
  remaining: string;
};
export type Installment = {
  id: string;
  no: number;
  dueYear: number;
  dueMonth: number;
  amount: string;
  status: 'scheduled' | 'deducted' | 'deferred' | 'cancelled';
  deferredReason: string | null;
  systemDeferred: boolean;
};
export type PaymentRow = {
  id: string;
  kind: 'payslip' | 'loan';
  employeeNo: string | null;
  employeeName: string;
  amount: string;
  currency: string;
  status: 'pending' | 'paid';
  method: 'bank' | 'cash' | 'other' | null;
  reference: string | null;
  paidAt: string | null;
};
export type LoanDetail = LoanRow & {
  reason: string | null;
  cancelReason: string | null;
  installments: Installment[];
  payments: PaymentRow[];
};
