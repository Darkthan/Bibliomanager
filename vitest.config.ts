import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts', 'client/tests/**/*.{spec,test}.tsx'],
    environment: 'node',
    environmentMatchGlobs: [
      ['client/**', 'jsdom'],
    ],
    setupFiles: ['client/vitest.setup.ts'],
  },
});
