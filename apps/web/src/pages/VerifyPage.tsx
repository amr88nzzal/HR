import { Alert, Badge, Center, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

type Result = {
  valid: boolean;
  status: 'valid' | 'revoked';
  number: string;
  type: string;
  holder: string;
  company: string;
  issuedAt: string;
  fileSha256: string | null;
};

/** صفحة التحقق العامة من وثيقة (تُفتح بمسح رمز QR بلا تسجيل دخول): الحد الأدنى فقط والاسم مقنّع. */
export const VerifyPage = () => {
  const { t } = useTranslation();
  const { token } = useParams({ strict: false }) as { token: string };
  const q = useQuery({
    queryKey: ['/public/verify', token],
    queryFn: async () => (await api.get<Result>(`/public/verify/${token}`)).data,
    retry: false,
  });
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" maw={520} w="100%" radius="md">
        <Stack>
          <Title order={3}>{t('verify.title')}</Title>
          {q.isLoading && <Loader />}
          {q.isError && <Alert color="red">{t('verify.notFound')}</Alert>}
          {q.data && (
            <>
              <Badge size="lg" color={q.data.valid ? 'teal' : 'red'} variant="light">
                {q.data.valid ? t('verify.valid') : t('verify.revoked')}
              </Badge>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>{t('verify.type')}</Table.Th>
                    <Table.Td>{q.data.type}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.number')}</Table.Th>
                    <Table.Td dir="ltr" ta="start">
                      {q.data.number}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.holder')}</Table.Th>
                    <Table.Td>{q.data.holder}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.company')}</Table.Th>
                    <Table.Td>{q.data.company}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{t('verify.issuedAt')}</Table.Th>
                    <Table.Td dir="ltr" ta="start">
                      {q.data.issuedAt}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              {q.data.fileSha256 && (
                <Text size="xs" c="dimmed" dir="ltr" ta="start" style={{ wordBreak: 'break-all' }}>
                  SHA-256: {q.data.fileSha256}
                </Text>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
};
