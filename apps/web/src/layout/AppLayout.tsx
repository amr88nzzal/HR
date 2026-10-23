import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  Kbd,
  Menu,
  ScrollArea,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { BrandLogo } from '../components/BrandLogo';
import { useDisclosure, useHotkeys, useMediaQuery } from '@mantine/hooks';
import {
  IconAdjustments,
  IconCheck,
  IconLanguage,
  IconLayoutSidebar,
  IconLogout,
  IconMoon,
  IconPassword,
  IconSearch,
  IconSun,
  IconUserCircle,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { setLang, type Lang } from '../i18n';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useNavPrefs } from '../lib/useNavPrefs';
import { NAV_MODES } from '@hrms/shared';
import { CustomizeNavModal } from './CustomizeNavModal';
import { NavSearchModal } from './NavSearchModal';
import { applyNavPrefs, visibleNav } from './nav';
import { SidebarNav } from './SidebarNav';

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { t, i18n } = useTranslation();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [opened, { toggle, close }] = useDisclosure();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const nav = visibleNav(me?.permissions ?? []);
  const { pref, save, reset } = useNavPrefs();
  const [customizing, setCustomizing] = useState(false);
  const [searching, search] = useDisclosure(false);
  useHotkeys([['mod+K', () => search.open()]], [], true);
  // عدّاد الموافقات المعلّقة لشارة «صندوق الموافقات»؛ فشله لا يعطّل القائمة
  // Pending-approvals count for the inbox badge; a failure must not break the sidebar
  const inbox = useQuery({
    queryKey: ['/approvals', 'inbox-count'],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<{ count: number }>('/approvals/inbox/count')).data.count,
  });
  const badges: Record<string, number> = inbox.data ? { '/approvals': inbox.data } : {};
  const view = applyNavPrefs(nav, pref);
  const desktop = useMediaQuery('(min-width: 48em)', true);
  // الأيقونات فقط للشاشات الواسعة؛ على الجوال تبقى القائمة كاملة لأنها درج منزلق
  // Icons-only is for wide screens; on mobile the menu stays full since it is a slide-over drawer
  const compact = pref.mode === 'icons' && desktop;

  const go = (to: string) => {
    close();
    void navigate({ to: to as never });
  };
  const nextLang: Lang = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: compact ? 64 : 260,
        breakpoint: 'sm',
        collapsed: { mobile: !opened, desktop: pref.mode === 'hidden' },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="menu" />
            <Menu position="bottom-start" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  visibleFrom="sm"
                  aria-label={t('navPrefs.menu')}
                  title={t('navPrefs.menu')}
                >
                  <IconLayoutSidebar size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {NAV_MODES.map((m) => (
                  <Menu.Item
                    key={m}
                    rightSection={pref.mode === m ? <IconCheck size={14} /> : null}
                    onClick={() => save({ ...pref, mode: m })}
                  >
                    {t(`navPrefs.modes.${m}`)}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconAdjustments size={16} />}
                  onClick={() => setCustomizing(true)}
                >
                  {t('navPrefs.customize')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
        {compact ? (
          <ActionIcon
            variant="default"
            size="lg"
            mb="xs"
            mx="auto"
            aria-label={t('navSearch.title')}
            title={`${t('navSearch.title')} (Ctrl+K)`}
            onClick={search.open}
          >
            <IconSearch size={18} />
          </ActionIcon>
        ) : (
          <Button
            variant="default"
            mb="xs"
            justify="space-between"
            leftSection={<IconSearch size={16} />}
            rightSection={<Kbd size="xs">Ctrl K</Kbd>}
            aria-label={t('navSearch.title')}
            onClick={search.open}
          >
            {t('navSearch.placeholder')}
          </Button>
        )}
        <AppShell.Section grow component={ScrollArea}>
          <SidebarNav
            nav={view.nav}
            favorites={view.favorites}
            compact={compact}
            badges={badges}
            pathname={pathname}
            onGo={go}
          />
        </AppShell.Section>
      </AppShell.Navbar>
      <NavSearchModal nav={nav} opened={searching} onClose={search.close} onGo={go} />
      {customizing && (
        <CustomizeNavModal
          nav={nav}
          pref={pref}
          onSave={save}
          onReset={reset}
          onClose={() => setCustomizing(false)}
        />
      )}
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
};
