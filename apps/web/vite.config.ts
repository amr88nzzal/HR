import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // مكتبات ثابتة في حزم مستقلة تُخزَّن في المتصفح ولا تتغير مع كل نشر
        // Stable libraries in their own long-cached chunks that don't change per deploy
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            { name: 'vendor-mantine', test: /node_modules[\\/]@mantine[\\/]/, priority: 20 },
            { name: 'vendor-tanstack', test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            { name: 'vendor-icons', test: /node_modules[\\/]@tabler[\\/]/, priority: 20 },
            {
              name: 'vendor-i18n',
              test: /node_modules[\\/](i18next|react-i18next)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
});
