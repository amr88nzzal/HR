import { Group, Kbd, Modal, NavLink, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isGroup, type NavGroup, type NavLeaf } from './nav';

/** تطبيع للبحث: حروف صغيرة ودون تشكيل ولا اختلاف الألف والياء/التاء المربوطة. / Search normalisation: lowercase, no diacritics, unified alef/yeh/teh-marbuta. */
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();

/**
 * بحث سريع في كل الشاشات المسموحة (Ctrl/⌘+K): يعمل في كل أوضاع القائمة، والأسهم للتنقل وEnter للفتح.
 * Quick search across every permitted screen (Ctrl/⌘+K); works in every sidebar mode, arrows to move and Enter to open.
 */
export const NavSearchModal = ({
  nav,
  opened,
  onClose,
  onGo,
}: {
  nav: (NavLeaf | NavGroup)[];
  opened: boolean;
  onClose: () => void;
  onGo: (to: string) => void;
}) => {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const entries = useMemo(
    () =>
      nav.flatMap((n) =>
        isGroup(n)
          ? n.items.map((l) => ({ leaf: l, group: t(`nav.${n.key}`) }))
          : [{ leaf: n, group: '' }],
      ),
    [nav, t],
  );
  const needle = norm(q);
  const hits = needle
    ? entries.filter((e) => norm(`${t(`nav.${e.leaf.key}`)} ${e.group}`).includes(needle))
    : entries;
  const go = (path: string) => {
    onClose();
    setQ('');
    setIdx(0);
    onGo(path);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hits[idx]) {
      e.preventDefault();
      go(hits[idx].leaf.path);
    }
  };
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding="sm"
      size="md"
      yOffset="12vh"
      aria-label={t('navSearch.title')}
    >
      <Stack gap="xs">
        <TextInput
          data-autofocus
          leftSection={<IconSearch size={16} />}
          placeholder={t('navSearch.placeholder')}
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setIdx(0);
          }}
          onKeyDown={onKey}
        />
        <ScrollArea.Autosize mah="50vh">
          <div role="listbox" aria-label={t('navSearch.title')}>
            {hits.map((e, i) => (
              <NavLink
                key={e.leaf.path}
                role="option"
                aria-selected={i === idx}
                active={i === idx}
                label={t(`nav.${e.leaf.key}`)}
                description={e.group || undefined}
                leftSection={<e.leaf.icon size={18} />}
                onClick={() => go(e.leaf.path)}
                onMouseEnter={() => setIdx(i)}
              />
            ))}
          </div>
          {hits.length === 0 && (
            <Text c="dimmed" size="sm" ta="center" py="md">
              {t('navSearch.empty')}
            </Text>
          )}
        </ScrollArea.Autosize>
        <Group gap={6} justify="flex-end">
          <Kbd size="xs">↑↓</Kbd>
          <Kbd size="xs">Enter</Kbd>
          <Kbd size="xs">Esc</Kbd>
        </Group>
      </Stack>
    </Modal>
  );
};
