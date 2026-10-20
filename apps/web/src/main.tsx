import '@fontsource-variable/noto-sans-arabic';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';

// بعد نشر جديد قد تطلب صفحة مفتوحة حزمة قديمة حُذفت: نعيد التحميل مرة واحدة لجلب النسخة الجديدة
// After a new deploy an open tab may request a removed old chunk: reload once to fetch the new build
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem('chunk-reloaded')) return;
    sessionStorage.setItem('chunk-reloaded', '1');
  } catch {
    // التخزين غير متاح: نعيد التحميل مرة بلا حارس / storage unavailable: reload without guard
  }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
