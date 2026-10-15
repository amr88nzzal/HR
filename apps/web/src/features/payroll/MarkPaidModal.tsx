import { Button, Group, Modal, NativeSelect, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';

/** تعليم دفعة (أو مجموعة دفعات) مدفوعة: الطريقة والمرجع والتاريخ. */
export const MarkPaidModal = ({ ids, onClose }: { ids: string[]; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const save = useMutation({
    mutationFn: async () =>
      ids.length === 1
        ? api.post(`/payroll/payments/${ids[0]}/mark`, {
            method,
            reference: reference || null,
            paidAt,
          })
        : api.post('/payroll/payments/mark', { ids, method, reference: reference || null, paidAt }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.markPaid')} centered>
      <Stack>
        <NativeSelect
          label={t('loans.method')}
          value={method}
          onChange={(e) => setMethod(e.currentTarget.value)}
          data={['bank', 'cash', 'other'].map((m) => ({
            value: m,
            label: t(`loans.methods.${m}`),
          }))}
        />
        <TextInput
          label={t('loans.reference')}
          dir="ltr"
          value={reference}
          onChange={(e) => setReference(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t('loans.paidAt')}
          value={paidAt}
          onChange={(e) => setPaidAt(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!paidAt} onClick={() => save.mutate()}>
            {t('loans.markPaid')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
