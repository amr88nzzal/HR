import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Divider,
  Indicator,
  NavLink,
  Stack,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconSettings,
  IconStar,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isGroup, type NavGroup, type NavLeaf } from './nav';

/** مفتاح قسم «الإعداد» المطوي داخل مجموعة. / Key of a group's folded "Setup" section. */
export const setupKey = (group: string) => `${group}.setup`;
const STORAGE_KEY = 'hrms.nav.open';
/** أول دخول: «مساحتي» وحدها مفتوحة (والمجموعة الحالية تُفتح تلقائياً)، فتبدأ القائمة قصيرة. */
const DEFAULT_OPEN = ['mySpace'];

export const loadOpen = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
};
const saveOpen = (keys: string[]) => {
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

const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * القائمة الجانبية: المجموعات (بأيقونة) تُطوى وتُفتح وتُحفظ حالتها، والمجموعة الحالية تُفتح تلقائياً،
 * وعناصر «الإعداد» في قسم مطوي منفصل داخل مجموعتها، وشارات العدد (الموافقات المعلّقة) على العنصر وعلى رأس المجموعة المطوية.
 * Sidebar: iconned groups fold and remember their state, the current group opens itself, setup items sit in
 * a separate folded section inside their group, and count badges show on the item and on a folded group header.
 */
export const SidebarNav = ({
  nav,
  favorites = [],
  compact = false,
  badges = {},
  pathname,
  onGo,
}: {
  nav: (NavLeaf | NavGroup)[];
  /** عناصر المفضلة: تظهر في أعلى القائمة كمجموعة «المفضلة». / Favourite items, shown first as a "Favourites" group. */
  favorites?: NavLeaf[];
  /** وضع الأيقونات فقط: بلا نصوص ولا طيّ، والاسم في تلميح. / Icons-only mode: no labels or folding, the name is in a tooltip. */
  compact?: boolean;
  /** عدّاد لكل مسار عنصر (مثل الموافقات المعلّقة). / A count per item path (e.g. pending approvals). */
  badges?: Record<string, number>;
  pathname: string;
  onGo: (to: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string[]>(loadOpen);
  const rtl = i18n.dir() === 'rtl';

  const activePath = activeLeafPath(nav, pathname);
  const activeLeaf = nav
    .flatMap((n) => (isGroup(n) ? n.items : [n]))
    .find((l) => l.path === activePath);
  const activeGroup = nav.find(
    (n): n is NavGroup => isGroup(n) && n.items.some((i) => i.path === activePath),
  )?.key;
  // الصفحة الحالية تُظهر مجموعتها (وقسم الإعداد إن كانت منه) تلقائياً
  // The current page reveals its group (and the Setup section if it belongs there) automatically
  useEffect(() => {
    if (!activeGroup) return;
    const need = [activeGroup, ...(activeLeaf?.setup ? [setupKey(activeGroup)] : [])];
    setOpen((o) => (need.every((k) => o.includes(k)) ? o : [...new Set([...o, ...need])]));
  }, [activeGroup, activeLeaf?.setup]);

  const toggle = (key: string) =>
    setOpen((o) => {
      const next = o.includes(key) ? o.filter((k) => k !== key) : [...o, key];
      saveOpen(next);
      return next;
    });

  const count = (l: NavLeaf) => badges[l.path] ?? 0;
  const leaf = (l: NavLeaf) => (
    <NavLink
      key={l.path}
      label={t(`nav.${l.key}`)}
      leftSection={<l.icon size={18} />}
      rightSection={
        count(l) > 0 ? (
          <Badge size="sm" circle={count(l) < 10} color="red" aria-label={`${count(l)}`}>
            {badgeText(count(l))}
          </Badge>
        ) : null
      }
      active={l.path === activePath}
      onClick={() => onGo(l.path)}
    />
  );

  const all: (NavLeaf | NavGroup)[] = favorites.length
    ? [
        { key: 'favorites', icon: IconStar, items: favorites.map((l) => ({ ...l, setup: false })) },
        ...nav,
      ]
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
                  <Indicator
                    label={badgeText(count(l))}
                    size={16}
                    offset={4}
                    color="red"
                    disabled={!count(l)}
                  >
                    <ActionIcon
                      size="lg"
                      variant={l.path === activePath ? 'light' : 'subtle'}
                      aria-label={t(`nav.${l.key}`)}
                      aria-current={l.path === activePath ? 'page' : undefined}
                      onClick={() => onGo(l.path)}
                    >
                      <l.icon size={20} />
                    </ActionIcon>
                  </Indicator>
                </Tooltip>
              ))}
            </Stack>
          );
        })}
      </Stack>
    );

  const Chevron = (isOpen: boolean) =>
    isOpen ? IconChevronDown : rtl ? IconChevronLeft : IconChevronRight;
  const tree = {
    marginInlineStart: 20,
    paddingInlineStart: 4,
    borderInlineStart: '1px solid var(--mantine-color-default-border)',
  } as const;

  return (
    <>
      {all.map((n) => {
        if (!isGroup(n)) return leaf(n);
        const isOpen = open.includes(n.key);
        const hasActive = n.key === activeGroup;
        const Ch = Chevron(isOpen);
        const main = n.items.filter((l) => !l.setup);
        const setup = n.items.filter((l) => l.setup);
        const setupOpen = open.includes(setupKey(n.key));
        const SetupCh = Chevron(setupOpen);
        const pending = n.items.reduce((s, l) => s + count(l), 0);
        return (
          <div key={n.key} data-group={n.key}>
            <NavLink
              component="button"
              label={t(`nav.${n.key}`)}
              fw={600}
              leftSection={<n.icon size={18} />}
              rightSection={
                <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isOpen && pending > 0 && (
                    <Badge size="sm" circle={pending < 10} color="red" aria-label={`${pending}`}>
                      {badgeText(pending)}
                    </Badge>
                  )}
                  <Ch size={14} />
                </Box>
              }
              c={hasActive ? 'var(--mantine-primary-color-filled)' : undefined}
              aria-expanded={isOpen}
              aria-label={t(`nav.${n.key}`)}
              onClick={() => toggle(n.key)}
            />
            <Collapse expanded={isOpen}>
              <div style={tree}>
                {main.map(leaf)}
                {setup.length > 0 && (
                  <>
                    <NavLink
                      component="button"
                      label={t('nav.setupSection')}
                      fz="xs"
                      c="dimmed"
                      leftSection={<IconSettings size={14} />}
                      rightSection={<SetupCh size={12} />}
                      aria-expanded={setupOpen}
                      aria-label={`${t(`nav.${n.key}`)} — ${t('nav.setupSection')}`}
                      onClick={() => toggle(setupKey(n.key))}
                    />
                    <Collapse expanded={setupOpen}>{setup.map(leaf)}</Collapse>
                  </>
                )}
              </div>
            </Collapse>
          </div>
        );
      })}
    </>
  );
};
