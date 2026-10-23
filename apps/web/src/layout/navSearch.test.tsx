import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { NavSearchModal, norm } from './NavSearchModal';
import { visibleNav } from './nav';

describe('البحث السريع في القائمة', () => {
  it('التطبيع يتجاوز التشكيل وهمزات الألف والتاء المربوطة', () => {
    expect(norm('إجازاتي')).toBe(norm('اجازاتي'));
    expect(norm('الرواتبُ')).toBe(norm('الرواتب'));
    expect(norm('مدرسة')).toBe(norm('مدرسه'));
  });

  it('يرشّح بالاسم أو اسم المجموعة ويفتح بـ Enter', async () => {
    const onGo = vi.fn();
    const nav = visibleNav(['leave.request.submit', 'leave.balance.read']);
    render(
      <MantineProvider>
        <NavSearchModal nav={nav} opened onClose={vi.fn()} onGo={onGo} />
      </MantineProvider>,
    );
    await userEvent.type(await screen.findByPlaceholderText('ابحث عن شاشة…'), 'اجازاتي');
    expect(screen.getAllByRole('option').length).toBe(1);
    await userEvent.keyboard('{Enter}');
    expect(onGo).toHaveBeenCalledWith('/leave');
  });

  it('رسالة عند عدم وجود نتائج', async () => {
    const nav = visibleNav([]);
    render(
      <MantineProvider>
        <NavSearchModal nav={nav} opened onClose={vi.fn()} onGo={vi.fn()} />
      </MantineProvider>,
    );
    await userEvent.type(await screen.findByPlaceholderText('ابحث عن شاشة…'), 'zzzzqq');
    expect(await screen.findByText('لا نتائج مطابقة')).toBeTruthy();
  });
});
