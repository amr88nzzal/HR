import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { isGroup, visibleNav } from './nav';
import { SidebarNav } from './SidebarNav';

const nav = visibleNav(['leave.request.submit', 'leave.type.read', 'leave.holiday.read']);

const show = (pathname: string) =>
  render(
    <MantineProvider>
      <SidebarNav nav={nav} pathname={pathname} onGo={vi.fn()} />
    </MantineProvider>,
  );

describe('طيّ مجموعات القائمة', () => {
  beforeEach(() => localStorage.clear());

  it('تُطوى المجموعة بالنقر وتُفتح مجدداً وتُحفظ الحالة', async () => {
    const { unmount } = show('/');
    const header = await screen.findByRole('button', { name: 'الإجازات' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('hrms.nav.collapsed') ?? '[]')).toContain('leaveGroup');
    unmount();
    show('/');
    expect(
      (await screen.findByRole('button', { name: 'الإجازات' })).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('المجموعة التي فيها الصفحة الحالية تُفتح تلقائياً رغم طيّها', async () => {
    localStorage.setItem('hrms.nav.collapsed', JSON.stringify(['leaveGroup']));
    show('/leave/types');
    expect(
      (await screen.findByRole('button', { name: 'الإجازات' })).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('العناصر المنفردة (الرئيسية) لا رأس لها', () => {
    show('/');
    expect(nav.filter((n) => !isGroup(n)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { expanded: true }).length).toBe(
      nav.filter(isGroup).length,
    );
  });
});
