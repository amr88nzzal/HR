import { Alert, Button, Group, List, Menu, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';

type BankCheck = {
  rows: number;
  total: string;
  currency: string;
  missing: { employeeNo: string; name: string }[];
};
type JournalCheck = {
  debit: string;
  credit: string;
  balanced: boolean;
  unmapped: { description: string }[];
};
type Pending =
  | { kind: 'bank'; format: 'xlsx' | 'csv'; info: BankCheck }
  | { kind: 'journal'; format: 'xlsx' | 'csv'; info: JournalCheck };

/**
 * مستندات الدورة: كشف الإدارة (PDF/Excel)، ملف تحويل البنك، وقيد المحاسبة.
 * الملفان الحساسان يمرّان بفحص أولاً (موظفون بلا IBAN، بنود بلا حساب) ثم يؤكّد المستخدم التنزيل.
 * Period documents: management sheet, bank file, accounting journal. The two sensitive ones run a check first.
 */
export const PeriodDocsMenu = ({
  periodId,
  status,
}: {
  periodId: string;
  status: 'draft' | 'approved' | 'locked';
}) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const base = `/payroll/periods/${periodId}`;
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const download = async (path: string, format: string, name: string) => {
    setBusy(true);
    try {
      downloadBlob(await api.blob(`${base}/${path}`, { format, lang }), `${name}.${format}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const check = async (kind: 'bank' | 'journal', format: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      if (kind === 'bank') {
        const info = (await api.get<BankCheck>(`${base}/bank-transfer`, { format: 'check' })).data;
        setPending({ kind, format, info });
      } else {
        const info = (await api.get<JournalCheck>(`${base}/journal`, { format: 'check' })).data;
        if (info.balanced && !info.unmapped.length) {
          await download('journal', format, `payroll-journal-${periodId}`);
        } else setPending({ kind, format, info });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const canSheet = can('payroll.payslip.read');
  const canBank = can('payroll.bank_transfer.export') && status !== 'draft';
  const canJournal = can('payroll.accounting.read') && status !== 'draft';
  if (!canSheet && !canBank && !canJournal) return null;
  const go = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    await download(
      p.kind === 'bank' ? 'bank-transfer' : 'journal',
      p.format,
      `${p.kind === 'bank' ? 'bank-transfer' : 'payroll-journal'}-${periodId}`,
    );
  };
  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" loading={busy}>
            {t('payroll.docs.menu')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {canSheet && (
            <>
              <Menu.Item
                onClick={() =>
                  void download('management-sheet', 'pdf', `payroll-sheet-${periodId}`)
                }
              >
                {t('payroll.docs.sheetPdf')}
              </Menu.Item>
              <Menu.Item
                onClick={() =>
                  void download('management-sheet', 'xlsx', `payroll-sheet-${periodId}`)
                }
              >
                {t('payroll.docs.sheetXlsx')}
              </Menu.Item>
            </>
          )}
          {canBank && (
            <>
              <Menu.Divider />
              <Menu.Item onClick={() => void check('bank', 'xlsx')}>
                {t('payroll.docs.bankXlsx')}
              </Menu.Item>
              <Menu.Item onClick={() => void check('bank', 'csv')}>
                {t('payroll.docs.bankCsv')}
              </Menu.Item>
            </>
          )}
          {canJournal && (
            <>
              <Menu.Divider />
              <Menu.Item onClick={() => void check('journal', 'xlsx')}>
                {t('payroll.docs.journalXlsx')}
              </Menu.Item>
              <Menu.Item onClick={() => void check('journal', 'csv')}>
                {t('payroll.docs.journalCsv')}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
      <Modal
        opened={!!pending}
        onClose={() => setPending(null)}
        title={
          pending?.kind === 'bank' ? t('payroll.docs.bankTitle') : t('payroll.docs.journalTitle')
        }
      >
        {pending?.kind === 'bank' && (
          <Stack>
            <Text fw={600}>
              {pending.info.rows
                ? t('payroll.docs.bankSummary', {
                    rows: pending.info.rows,
                    total: pending.info.total,
                    currency: pending.info.currency,
                  })
                : t('payroll.docs.bankNone')}
            </Text>
            {pending.info.missing.length > 0 && (
              <Alert color="orange">
                <Text size="sm">{t('payroll.docs.bankMissing')}</Text>
                <List size="sm" mt="xs">
                  {pending.info.missing.map((m, i) => (
                    <List.Item key={i}>
                      {m.employeeNo} {m.name}
                    </List.Item>
                  ))}
                </List>
              </Alert>
            )}
            <Text size="xs" c="dimmed">
              {t('payroll.docs.bankNote')}
            </Text>
          </Stack>
        )}
        {pending?.kind === 'journal' && (
          <Stack>
            {pending.info.unmapped.length > 0 && (
              <Alert color="orange">
                {t('payroll.docs.journalUnmapped', { n: pending.info.unmapped.length })}
              </Alert>
            )}
            {!pending.info.balanced && (
              <Alert color="red">
                {t('payroll.docs.journalUnbalanced', {
                  debit: pending.info.debit,
                  credit: pending.info.credit,
                })}
              </Alert>
            )}
          </Stack>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setPending(null)}>
            {t('payroll.docs.cancel')}
          </Button>
          <Button
            onClick={() => void go()}
            disabled={pending?.kind === 'bank' && pending.info.rows === 0}
          >
            {t('payroll.docs.continue')}
          </Button>
        </Group>
      </Modal>
    </>
  );
};
