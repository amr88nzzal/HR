import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api/client';
import { DEFAULT_FORMAT, formatDate, formatDateTime, type FormatSettings } from './format';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * منسّقات العرض حسب إعدادات المستخدم الفعلية (تقويم، صيغة تاريخ، أرقام، منطقة زمنية).
 * التاريخ بلا وقت (YYYY-MM-DD) يُنسَّق بلا تحويل منطقة زمنية فلا يتغير اليوم.
 */
export const useFormat = () => {
  const q = useQuery({
    queryKey: ['/settings', 'effective'],
    queryFn: async () => (await api.get<Partial<FormatSettings>>('/settings/effective')).data,
    staleTime: 60_000,
  });
  const settings: FormatSettings = useMemo(
    () => ({ ...DEFAULT_FORMAT, ...(q.data ?? {}) }),
    [q.data],
  );
  return useMemo(
    () => ({
      settings,
      date: (v: unknown): string => {
        if (typeof v !== 'string' || !v) return '—';
        const out = DATE_ONLY.test(v)
          ? formatDate(v, { ...settings, timezone: 'UTC' })
          : formatDate(v, settings);
        return out || '—';
      },
      dateTime: (v: unknown): string =>
        typeof v === 'string' && v ? formatDateTime(v, settings) || '—' : '—',
    }),
    [settings],
  );
};
