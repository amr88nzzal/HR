import { navPrefInput } from '@hrms/shared';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { CustomizeNavModal } from './CustomizeNavModal';
import { applyNavPrefs, isGroup, visibleNav } from './nav';
import { SidebarNav } from './SidebarNav';

const perms = ['leave.request.submit', 'leave.type.read', 'leave.holiday.read'];
const nav = visibleNav(perms);
const pref = (p: object = {}) => navPrefInput.parse(p);
const leaves = (n: ReturnType<typeof visibleNav>) =>
  n.flatMap((x) => (isGroup(x) ? x.items.map((l) => l.path) : [x.path]));

describe('تفضيلات القائمة الجانبية: التطبيق', () => {
  it('بلا تفضيلات: القائمة كما هي', () => {
    const v = applyNavPrefs(nav, pref());
    expect(leaves(v.nav)).toEqual(leaves(nav));
    expect(v.favorites).toEqual([]);
  });

  it('يرتّب المجموعات والعناصر ويُبقي غير المذكور بعد المذكور', () => {
    const group = nav.find(isGroup)!;
    const rev = [...group.items].reverse().map((l) => l.path);
    const v = applyNavPrefs(
      nav,
      pref({ groupOrder: [group.key], itemOrder: { [group.key]: rev } }),
    );
    expect(isGroup(v.nav[0]!) && v.nav[0].key).toBe(group.key);
    expect((v.nav[0] as typeof group).items.map((l) => l.path)).toEqual(rev);
  });

  it('يخفي العنصر، وتختفي المجموعة إن فرغت، والمفضلة تبقى ولو أُخفي مكانها', () => {
    const group = nav.find(isGroup)!;
    const all = group.items.map((l) => l.path);
    const v = applyNavPrefs(nav, pref({ hidden: all, favorites: [all[0], '/gone'] }));
    expect(v.nav.some((n) => n.key === group.key)).toBe(false);
    expect(v.favorites.map((l) => l.path)).toEqual([all[0]]); // المجهول يسقط
  });
});

describe('الواجهة', () => {
  const show = (props: Partial<Parameters<typeof SidebarNav>[0]>) =>
    render(
      <MantineProvider>
        <SidebarNav nav={nav} pathname="/" onGo={vi.fn()} {...props} />
      </MantineProvider>,
    );

  it('وضع الأيقونات: أزرار بأسماء بلا رؤوس مجموعات', () => {
    show({ compact: true });
    expect(screen.queryByRole('button', { name: 'الإجازات' })).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(leaves(nav).length);
  });

  it('المفضلة تظهر مجموعة أولى', () => {
    const fav = nav.find(isGroup)!.items[0]!;
    show({ favorites: [fav] });
    expect(screen.getByRole('button', { name: 'المفضلة' })).toBeTruthy();
  });

  it('نافذة التخصيص: إخفاء ونجمة ثم حفظ', async () => {
    const onSave = vi.fn();
    render(
      <MantineProvider>
        <CustomizeNavModal
          nav={nav}
          pref={pref({ mode: 'icons' })}
          onSave={onSave}
          onReset={vi.fn()}
          onClose={vi.fn()}
        />
      </MantineProvider>,
    );
    const first = leaves(nav)[0]!;
    await userEvent.click(screen.getAllByRole('button', { name: 'إخفاء' })[0]!);
    await userEvent.click(screen.getAllByRole('button', { name: 'مفضلة' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    const saved = onSave.mock.calls[0]![0];
    expect(saved.mode).toBe('icons');
    expect(saved.hidden).toContain(first);
    expect(saved.favorites).toContain(first);
    expect(saved.groupOrder.length).toBe(nav.length);
  });
});
