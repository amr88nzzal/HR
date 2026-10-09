import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@hrms/shared'],
});
