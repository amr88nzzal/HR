import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiEnvelope } from '@hrms/shared';
import { api } from './client';

export type ListMeta = { page: number; pageSize: number; total: number };
export type Row = Record<string, unknown> & { id: string; version?: number };

export const useList = <T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  enabled = true,
) =>
  useQuery({
    queryKey: [path, 'list', params],
    queryFn: async (): Promise<ApiEnvelope<T[], ListMeta>> =>
      (await api.get<T[]>(path, params)) as ApiEnvelope<T[], ListMeta>,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useOne = <T = Row>(path: string, id: string | null) =>
  useQuery({
    queryKey: [path, 'one', id],
    queryFn: async () => (await api.get<T>(`${path}/${id}`)).data,
    enabled: !!id,
  });

/** إنشاء/تعديل: إن وُجد id يُرسل PATCH وإلا POST، ثم تُبطل ذاكرة المسار. */
export const useSave = (path: string, invalidate: string[] = []) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: unknown }) =>
      (id ? await api.patch<Row>(`${path}/${id}`, body) : await api.post<Row>(path, body)).data,
    onSuccess: () =>
      Promise.all([path, ...invalidate].map((p) => qc.invalidateQueries({ queryKey: [p] }))),
  });
};

export const useRemove = (path: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => void (await api.del(`${path}/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [path] }),
  });
};
