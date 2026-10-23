import { navPrefInput, type NavPref } from '@hrms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api/client';

const DEFAULT: NavPref = navPrefInput.parse({});
const KEY = ['/nav-prefs'];

/** تفضيلات القائمة الجانبية لكل مستخدم (محفوظة في الخادم). الأخطاء صامتة: تعمل القائمة بترتيبها الافتراضي. */
export const useNavPrefs = () => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = navPrefInput.safeParse((await api.get<unknown>('/nav-prefs')).data);
      return r.success ? r.data : DEFAULT;
    },
  });
  const save = useMutation({
    mutationFn: async (p: NavPref) => (await api.put<NavPref>('/nav-prefs', p)).data,
    onMutate: async (p) => qc.setQueryData(KEY, p),
  });
  const reset = useMutation({
    mutationFn: async () => api.del('/nav-prefs'),
    onMutate: async () => qc.setQueryData(KEY, DEFAULT),
  });
  return {
    pref: q.data ?? DEFAULT,
    save: useCallback((p: NavPref) => save.mutate(p), [save]),
    reset: useCallback(() => reset.mutate(), [reset]),
  };
};
