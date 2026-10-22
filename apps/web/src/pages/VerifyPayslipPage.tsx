import { Alert, Badge, Center, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

type Result =
  | { valid: false; status: 'mismatch' }
  | {
      valid: true;
      status: 'valid';
      company: string;
      holder: string;
      year: number;
      month: number;
    };

/**
 * صفحة التحقق العامة من قسيمة راتب (QR، بلا تسجيل دخول): الشركة والشهر والاسم مقنّعاً فقط، بلا أي مبلغ.
 * Public payslip verification (QR, no login): company, month and masked name only; never any amount.
 */
export const VerifyPayslipPage = () => {
  const { t } = useTranslation();
  const { token } = useParams({ strict: false }) as { token: string };
  const q = useQuery({
    queryKey: ['/public/verify/payslip', token],
    queryFn: async () => (await api.get<Result>(`/public/verify/payslip/${token}`)).data,
    retry: false,
  });
  const d = q.data;
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" maw={520} w="100%" radius="md">
        <Stack>
          <Title order={3}>{t('verify.payslipTitle')}</Title>
          {q.isLoading && <Loader />}
          {q.isError && <Alert color="red">{t('verify.notFound')}</Alert>}
          {d && !d.valid && (
            <>
              <Badge size="lg" color="red" variant="light">
                {t('verify.payslipMismatch')}
              </Badge>
              <Alert color="red">{t('verify.payslipMismatchHint')}</Alert>
            </>
          )}
          {d?.valid && (
            <>
              <Badge size="lg" color="teal" variant="light">
                {t('verify.payslipValid')}
              </Badge>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>{t('verify.company')}</Table.Th>
                    <Table.Td>{d.company}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.employee')}</Table.Th>
                    <Table.Td>{d.holder}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.month')}</Table.Th>
                    <Table.Td dir="ltr" ta="start">
                      {d.year}-{String(d.month).padStart(2, '0')}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed">
                {t('verify.payslipHint')}
              </Text>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
};
