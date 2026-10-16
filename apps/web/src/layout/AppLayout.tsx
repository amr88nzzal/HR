import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  Menu,
  ScrollArea,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { BrandLogo } from '../components/BrandLogo';
import { useDisclosure } from '@mantine/hooks';
import {
  IconLanguage,
  IconLogout,
  IconMoon,
  IconPassword,
  IconSun,
  IconUserCircle,
} from '@tabler/icons-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { setLang, type Lang } from '../i18n';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { visibleNav } from './nav';
import { SidebarNav } from './SidebarNav';

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { t, i18n } = useTranslation();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [opened, { toggle, close }] = useDisclosure();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const nav = visibleNav(me?.permissions ?? []);

  const go = (to: string) => {
    close();
    void navigate({ to: to as never });
  };
  const nextLang: Lang = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="menu" />
            <BrandLogo />
            <Title order={4}>{t('app.name')}</Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <NotificationBell />
            <ActionIcon
              variant="subtle"
              onClick={() => void setLang(nextLang)}
              aria-label={t('common.language')}
              title={t('common.language')}
            >
              <IconLanguage size={20} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              onClick={toggleColorScheme}
              aria-label={t('common.theme')}
              title={t('common.theme')}
            >
              {colorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
            </ActionIcon>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={me?.displayName}>
                  <IconUserCircle size={22} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me?.displayName}</Menu.Label>
                <Menu.Item
                  leftSection={<IconPassword size={16} />}
                  onClick={() => go('/change-password')}
                >
                  {t('password.title')}
                </Menu.Item>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
                  {t('common.logout')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <ScrollArea>
          <SidebarNav nav={nav} pathname={pathname} onGo={go} />
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
};
