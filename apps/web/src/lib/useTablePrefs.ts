import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api/client';
import type { ColPref } from './tableTools';

const EMPTY: ColPref = { order: [], hidden: [] };

/** تفضيلات أعمدة جدول لكل مستخدم (محفوظة في الخادم). الأخطاء صامتة: يعمل الجدول بالترتيب الافتراضي. */
export const useTablePrefs = (tableId: string | undefined) => {
  const qc = useQueryClient();
  const key = ['/table-prefs', tableId];
  const q = useQuery({
    queryKey: key,
    enabled: !!tableId,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = (await api.get<Partial<ColPref>>(`/table-prefs/${tableId}`)).data;
      return {
        order: Array.isArray(d?.order) ? d.order : [],
        hidden: Array.isArray(d?.hidden) ? d.hidden : [],
      };
    },
  });
  const save = useMutation({
    mutationFn: async (p: ColPref) => (await api.put<ColPref>(`/table-prefs/${tableId}`, p)).data,
    onMutate: async (p) => qc.setQueryData(key, p),
  });
  const reset = useMutation({
    mutationFn: async () => api.del(`/table-prefs/${tableId}`),
    onMutate: async () => qc.setQueryData(key, EMPTY),
  });
  return {
    pref: q.data ?? EMPTY,
    save: useCallback((p: ColPref) => save.mutate(p), [save]),
    reset: useCallback(() => reset.mutate(), [reset]),
  };
};
