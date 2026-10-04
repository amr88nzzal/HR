import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';

export const DashboardPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  return (
    <Stack>
      <Title order={2}>{t('dashboard.welcome', { name: me?.displayName })}</Title>
    </Stack>
  );
};

export const ComingSoonPage = ({ titleKey }: { titleKey: string }) => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t(`nav.${titleKey}`)}</Title>
      <Text c="dimmed">{t('common.comingSoon')}</Text>
    </Stack>
  );
};

export const ForbiddenPage = () => {
  const { t } = useTranslation();
  return (
    <Center mih="50vh">
      <Stack align="center">
        <Title order={2}>{t('errors.forbiddenTitle')}</Title>
        <Text c="dimmed">{t('errors.forbidden')}</Text>
        <Button component={Link} to="/">
          {t('errors.home')}
        </Button>
      </Stack>
    </Center>
  );
};

export const NotFoundPage = () => {
  const { t } = useTranslation();
  return (
    <Center mih="50vh">
      <Stack align="center">
        <Title order={2}>{t('errors.notFoundTitle')}</Title>
        <Text c="dimmed">{t('errors.notFound')}</Text>
        <Button component={Link} to="/">
          {t('errors.home')}
        </Button>
      </Stack>
    </Center>
  );
};
