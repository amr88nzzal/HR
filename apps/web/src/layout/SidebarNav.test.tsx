import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { isGroup, visibleNav } from './nav';
import { activeLeafPath, SidebarNav } from './SidebarNav';

const nav = visibleNav([
  'leave.request.submit',
  'leave.balance.read',
  'leave.type.read',
  'leave.holiday.read',
]);

const show = (pathname: string, props: Partial<Parameters<typeof SidebarNav>[0]> = {}) =>
  render(
    <MantineProvider>
      <SidebarNav nav={nav} pathname={pathname} onGo={vi.fn()} {...props} />
    </MantineProvider>,
  );
const header = (name: string) => screen.findByRole('button', { name });

describe('طيّ مجموعات القائمة', () => {
  beforeEach(() => localStorage.clear());

  it('أول دخول: «مساحتي» وحدها مفتوحة وباقي المجموعات مطوية', async () => {
    show('/');
    expect((await header('مساحتي')).getAttribute('aria-expanded')).toBe('true');
    expect((await header('الإجازات')).getAttribute('aria-expanded')).toBe('false');
  });

  it('تُفتح المجموعة بالنقر وتُحفظ الحالة بين الجلسات', async () => {
    const { unmount } = show('/');
    const h = await header('الإجازات');
    await userEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem('hrms.nav.open') ?? '[]')).toContain('leaveGroup');
    unmount();
    show('/');
    expect((await header('الإجازات')).getAttribute('aria-expanded')).toBe('true');
  });

  it('المجموعة التي فيها الصفحة الحالية تُفتح تلقائياً', async () => {
    show('/leave/balances');
    expect((await header('الإجازات')).getAttribute('aria-expanded')).toBe('true');
  });

  it('قسم «الإعداد» مطوي، ويُفتح تلقائياً حين تكون الصفحة الحالية منه', async () => {
    const { unmount } = show('/leave/balances');
    const setup = await header('الإجازات — الإعداد');
    expect(setup.getAttribute('aria-expanded')).toBe('false');
    unmount();
    localStorage.clear();
    show('/leave/types');
    expect((await header('الإجازات — الإعداد')).getAttribute('aria-expanded')).toBe('true');
  });

  it('العناصر المنفردة (الرئيسية) لا رأس لها', () => {
    show('/');
    expect(nav.filter((n) => !isGroup(n)).length).toBeGreaterThan(0);
    // رؤوس المجموعات فقط لها aria-expanded
    expect(
      screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded')).length,
    ).toBeGreaterThanOrEqual(nav.filter(isGroup).length);
  });

  it('شارة العدد على العنصر، وعلى رأس المجموعة إن كانت مطوية', async () => {
    const withInbox = visibleNav([]);
    const { container } = render(
      <MantineProvider>
        <SidebarNav nav={withInbox} badges={{ '/approvals': 3 }} pathname="/" onGo={vi.fn()} />
      </MantineProvider>,
    );
    expect(container.querySelector('[aria-label="3"]')).toBeTruthy();
    const mine = withInbox.filter(isGroup)[0]!;
    expect(mine.key).toBe('mySpace');
  });

  it('العنصر النشط الأطول مطابقة فقط', () => {
    const n = visibleNav([
      'attendance.import.read',
      'attendance.import_profile.read',
      'leave.request.submit',
    ]);
    expect(activeLeafPath(n, '/attendance/import/profiles')).toBe('/attendance/import/profiles');
    expect(activeLeafPath(n, '/attendance/import')).toBe('/attendance/import');
    expect(activeLeafPath(n, '/attendance')).toBe('/attendance');
    expect(activeLeafPath(n, '/unknown')).toBeNull();
  });
});
