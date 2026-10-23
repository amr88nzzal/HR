import { ActionIcon, Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconStar,
  IconStarFilled,
} from '@tabler/icons-react';
import { type NavPref } from '@hrms/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { entryKey, isGroup, orderNav, type NavGroup, type NavLeaf } from './nav';

const MAX_FAVORITES = 12;

/** صف قابل للسحب بمقبض؛ يدعم لوحة المفاتيح (مسافة ثم الأسهم). / A row draggable by its handle; keyboard works too (space, then arrows). */
const Row = ({ id, label, children }: { id: string; label: string; children: ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <Group gap="xs" wrap="nowrap" py={4}>
        <ActionIcon variant="subtle" color="gray" aria-label={label} {...attributes} {...listeners}>
          <IconGripVertical size={16} />
        </ActionIcon>
        {children}
      </Group>
    </div>
  );
};

/**
 * تخصيص القائمة الجانبية: سحب المجموعات والعناصر، إخفاء ما لا يلزم، وتثبيت المفضلة بنجمة.
 * Customise the sidebar: drag groups and items, hide what you don't need, star favourites.
 */
export const CustomizeNavModal = ({
  nav,
  pref,
  onSave,
  onReset,
  onClose,
}: {
  nav: (NavLeaf | NavGroup)[];
  pref: NavPref;
  onSave: (p: NavPref) => void;
  onReset: () => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // المسودة: الترتيب الحالي الكامل (بما فيه المخفي) كي يُحفظ كما يراه المستخدم
  // Draft: the full current order (hidden items included) so it is saved exactly as the user sees it
  const initial = orderNav(nav, pref);
  const [entries, setEntries] = useState(initial);
  const [hidden, setHidden] = useState(new Set(pref.hidden));
  const [favs, setFavs] = useState(pref.favorites);

  const moveEntry = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = entries.findIndex((n) => entryKey(n) === active.id);
    const to = entries.findIndex((n) => entryKey(n) === over.id);
    setEntries(arrayMove(entries, from, to));
  };
  const moveItem = (group: string) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEntries(
      entries.map((n) => {
        if (!isGroup(n) || n.key !== group) return n;
        const from = n.items.findIndex((l) => l.path === active.id);
        const to = n.items.findIndex((l) => l.path === over.id);
        return { ...n, items: arrayMove(n.items, from, to) };
      }),
    );
  };
  const toggleHidden = (path: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const toggleFav = (path: string) =>
    setFavs((f) =>
      f.includes(path) ? f.filter((p) => p !== path) : f.length < MAX_FAVORITES ? [...f, path] : f,
    );

  const leafRow = (l: NavLeaf) => (
    <Row key={l.path} id={l.path} label={t('navPrefs.drag')}>
      <l.icon size={16} />
      <Text size="sm" flex={1} c={hidden.has(l.path) ? 'dimmed' : undefined}>
        {t(`nav.${l.key}`)}
      </Text>
      <ActionIcon
        variant="subtle"
        color="yellow"
        aria-label={t('navPrefs.favorite')}
        aria-pressed={favs.includes(l.path)}
        disabled={!favs.includes(l.path) && favs.length >= MAX_FAVORITES}
        onClick={() => toggleFav(l.path)}
      >
        {favs.includes(l.path) ? <IconStarFilled size={16} /> : <IconStar size={16} />}
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={t('navPrefs.hide')}
        aria-pressed={hidden.has(l.path)}
        onClick={() => toggleHidden(l.path)}
      >
        {hidden.has(l.path) ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </ActionIcon>
    </Row>
  );

  const save = () =>
    onSave({
      mode: pref.mode,
      groupOrder: entries.map(entryKey),
      itemOrder: Object.fromEntries(
        entries.filter(isGroup).map((n) => [n.key, n.items.map((l) => l.path)]),
      ),
      hidden: [...hidden],
      favorites: favs,
    });

  return (
    <Modal opened onClose={onClose} title={t('navPrefs.title')} size="lg" centered>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('navPrefs.hint', { n: MAX_FAVORITES })}
        </Text>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={moveEntry}>
          <SortableContext items={entries.map(entryKey)} strategy={verticalListSortingStrategy}>
            <Stack gap="xs">
              {entries.map((n) =>
                isGroup(n) ? (
                  <Paper key={n.key} withBorder p="xs">
                    <Row id={n.key} label={t('navPrefs.dragGroup')}>
                      <n.icon size={16} />
                      <Text fw={600} size="sm">
                        {t(`nav.${n.key}`)}
                      </Text>
                    </Row>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={moveItem(n.key)}
                    >
                      <SortableContext
                        items={n.items.map((l) => l.path)}
                        strategy={verticalListSortingStrategy}
                      >
                        <Stack gap={0} ps="lg">
                          {n.items.map(leafRow)}
                        </Stack>
                      </SortableContext>
                    </DndContext>
                  </Paper>
                ) : (
                  <Paper key={n.key} withBorder p="xs">
                    <Row id={n.key} label={t('navPrefs.dragGroup')}>
                      <n.icon size={16} />
                      <Text size="sm" flex={1} c={hidden.has(n.path) ? 'dimmed' : undefined}>
                        {t(`nav.${n.key}`)}
                      </Text>
                      <ActionIcon
                        variant="subtle"
                        color="yellow"
                        aria-label={t('navPrefs.favorite')}
                        aria-pressed={favs.includes(n.path)}
                        disabled={!favs.includes(n.path) && favs.length >= MAX_FAVORITES}
                        onClick={() => toggleFav(n.path)}
                      >
                        {favs.includes(n.path) ? (
                          <IconStarFilled size={16} />
                        ) : (
                          <IconStar size={16} />
                        )}
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={t('navPrefs.hide')}
                        aria-pressed={hidden.has(n.path)}
                        onClick={() => toggleHidden(n.path)}
                      >
                        {hidden.has(n.path) ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                      </ActionIcon>
                    </Row>
                  </Paper>
                ),
              )}
            </Stack>
          </SortableContext>
        </DndContext>
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="red"
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            {t('navPrefs.reset')}
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                save();
                onClose();
              }}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};
