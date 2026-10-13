import { Stack, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { IssuePanel } from './IssuePanel';

export const IssuedPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('nav.issuedDocuments')}</Title>
      <IssuePanel />
    </Stack>
  );
};
