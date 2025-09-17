import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        name: 'server',
        test: {
          environment: 'node',
          include: ['tests/**/*.spec.ts'],
          exclude: ['client/**'],
        },
      },
      {
        name: 'client',
        test: {
          environment: 'jsdom',
          include: ['client/tests/**/*.{spec,test}.tsx'],
          setupFiles: ['client/vitest.setup.ts'],
          exclude: ['tests/**'],
        },
      },
    ],
  },
});
