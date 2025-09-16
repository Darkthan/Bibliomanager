import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [],
  },
  // Define two projects: server (node) and client (jsdom)
  projects: [
    // Backend tests
    defineConfig({
      test: {
        name: 'server',
        environment: 'node',
        include: ['tests/**/*.spec.ts'],
      },
    }),
    // Frontend tests
    defineConfig({
      test: {
        name: 'client',
        environment: 'jsdom',
        include: ['client/**/*.spec.tsx', 'client/**/*.test.tsx'],
        setupFiles: ['client/vitest.setup.ts'],
      },
    }),
  ],
});

