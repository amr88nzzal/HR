import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ApiEnvelope } from '@hrms/shared';
import { api as defaultApi, type ApiClient } from '../api/client';
import { hasPermission } from './permissions';

export type Me = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  companyId: string;
  mustChangePassword: boolean;
  permissionsVersion: number;
  permissions: string[];
};

type Status = 'loading' | 'anonymous' | 'authenticated';

type AuthValue = {
  status: Status;
  me: Me | null;
  login: (input: { identifier: string; password: string; company?: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** يُستدعى بعد تغيير كلمة المرور (الخادم يبطل الجلسات) */
  endSession: () => void;
  can: (code: string | undefined) => boolean;
};

const Ctx = createContext<AuthValue | null>(null);

export const AuthProvider = ({
  children,
  client = defaultApi,
}: {
  children: ReactNode;
  client?: ApiClient;
}) => {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const loadMe = useCallback(async () => {
    const res = await client.get<Me>('/auth/me');
    setMe(res.data);
    setStatus('authenticated');
  }, [client]);

  const reset = useCallback(() => {
    client.clearToken();
    setMe(null);
    setStatus('anonymous');
  }, [client]);

  // استعادة الجلسة عند الفتح من كوكي refresh
  useEffect(() => {
    let alive = true;
    void (async () => {
      const session = await client.restore();
      if (!alive) return;
      if (!session) return setStatus('anonymous');
      try {
        await loadMe();
      } catch {
        if (alive) reset();
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, loadMe, reset]);

  useEffect(() => client.onSessionExpired(reset), [client, reset]);

  // تغيّر نسخة الصلاحيات في ترويسة الاستجابة ← أعد تحميل /me لتحديث القوائم فوراً
  useEffect(
    () =>
      client.onPermissionsVersion((v) => {
        if (meRef.current && v !== meRef.current.permissionsVersion)
          void loadMe().catch(() => undefined);
      }),
    [client, loadMe],
  );

  const login = useCallback(
    async (input: { identifier: string; password: string; company?: string }) => {
      await client.login(input);
      await loadMe();
    },
    [client, loadMe],
  );

  const logout = useCallback(async () => {
    await client.logout().catch(() => undefined);
    reset();
  }, [client, reset]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      login,
      logout,
      endSession: reset,
      can: (code) => hasPermission(me?.permissions ?? [], code),
    }),
    [status, me, login, logout, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = (): AuthValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth خارج AuthProvider');
  return v;
};

export type { ApiEnvelope };
