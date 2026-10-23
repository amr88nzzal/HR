import {
  ActionIcon,
  Collapse,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isGroup, type NavGroup, type NavLeaf } from './nav';

const STORAGE_KEY = 'hrms.nav.collapsed';

export const loadCollapsed = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const saveCollapsed = (keys: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* التخزين غير متاح: تبقى الحالة في الذاكرة فقط */
  }
};

const matches = (path: string, pathname: string): boolean =>
  path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);

/** العنصر النشط هو أطول مسار يطابق الصفحة الحالية (فلا يضيء الأب والابن معاً). */
export const activeLeafPath = (nav: (NavLeaf | NavGroup)[], pathname: string): string | null => {
  const paths = nav.flatMap((n) => (isGroup(n) ? n.items : [n])).map((l) => l.path);
  const hit = paths.filter((p) => matches(p, pathname)).sort((a, b) => b.length - a.length)[0];
  return hit ?? null;
};

/** القائمة الجانبية: المجموعات تُطوى وتُفتح بالنقر وتُحفظ حالتها، والمجموعة الحالية تُفتح تلقائياً. */
export const SidebarNav = ({
  nav,
  favorites = [],
  compact = false,
  pathname,
  onGo,
}: {
  nav: (NavLeaf | NavGroup)[];
  /** عناصر المفضلة: تظهر في أعلى القائمة كمجموعة «المفضلة». / Favourite items, shown first as a "Favourites" group. */
  favorites?: NavLeaf[];
  /** وضع الأيقونات فقط: بلا نصوص ولا طيّ، والاسم في تلميح. / Icons-only mode: no labels or folding, the name is in a tooltip. */
  compact?: boolean;
  pathname: string;
  onGo: (to: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const rtl = i18n.dir() === 'rtl';

  const activePath = activeLeafPath(nav, pathname);
  const activeGroup = nav.find(
    (n): n is NavGroup => isGroup(n) && n.items.some((i) => i.path === activePath),
  )?.key;
  useEffect(() => {
    if (activeGroup)
      setCollapsed((c) => (c.includes(activeGroup) ? c.filter((k) => k !== activeGroup) : c));
  }, [activeGroup]);

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = c.includes(key) ? c.filter((k) => k !== key) : [...c, key];
      saveCollapsed(next);
      return next;
    });

  const leaf = (l: NavLeaf) => (
    <NavLink
      key={l.path}
      label={t(`nav.${l.key}`)}
      leftSection={<l.icon size={18} />}
      active={l.path === activePath}
      onClick={() => onGo(l.path)}
    />
  );

  const all: (NavLeaf | NavGroup)[] = favorites.length
    ? [{ key: 'favorites', items: favorites }, ...nav]
    : nav;

  if (compact)
    return (
      <Stack gap={2} align="center" data-compact="true">
        {all.map((n, i) => {
          const items = isGroup(n) ? n.items : [n];
          return (
            <Stack key={n.key} gap={2} align="center" w="100%">
              {i > 0 && <Divider w="70%" my={4} />}
              {items.map((l) => (
                <Tooltip key={l.path} label={t(`nav.${l.key}`)} position={rtl ? 'left' : 'right'}>
                  <ActionIcon
                    size="lg"
                    variant={l.path === activePath ? 'light' : 'subtle'}
                    aria-label={t(`nav.${l.key}`)}
                    aria-current={l.path === activePath ? 'page' : undefined}
                    onClick={() => onGo(l.path)}
                  >
                    <l.icon size={20} />
                  </ActionIcon>
                </Tooltip>
              ))}
            </Stack>
          );
        })}
      </Stack>
    );

  return (
    <>
      {all.map((n) => {
        if (!isGroup(n)) return leaf(n);
        const open = !collapsed.includes(n.key);
        const Chevron = open ? IconChevronDown : rtl ? IconChevronLeft : IconChevronRight;
        return (
          <div key={n.key} data-group={n.key}>
            <UnstyledButton
              w="100%"
              px="sm"
              pt="md"
              pb={4}
              aria-expanded={open}
              aria-label={t(`nav.${n.key}`)}
              onClick={() => toggle(n.key)}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600}>
                  {t(`nav.${n.key}`)}
                </Text>
                <Chevron size={14} color="var(--mantine-color-dimmed)" />
              </Group>
            </UnstyledButton>
            <Collapse expanded={open}>{n.items.map(leaf)}</Collapse>
          </div>
        );
      })}
    </>
  );
};
