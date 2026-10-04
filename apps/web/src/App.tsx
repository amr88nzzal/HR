import { useEffect, useState } from 'react';
import type { ApiEnvelope, Health } from '@hrms/shared';

export const App = () => {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/health/ready')
      .then((r) => r.json() as Promise<ApiEnvelope<Health>>)
      .then((body) => setHealth(body.data))
      .catch(() => setFailed(true));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>نظام شؤون الموظفين</h1>
      <p>حالة الخادم: {failed ? 'غير متاح' : (health?.status ?? '...')}</p>
    </main>
  );
};
