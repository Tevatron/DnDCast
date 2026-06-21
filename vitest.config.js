import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Server tests run in Node; client tests need a DOM environment.
    environmentMatchGlobs: [
      ['tests/client/**', 'jsdom'],
    ],
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server.js', 'public/js/**/*.js'],
      exclude: ['public/js/sync.js', 'public/js/app.js'],
    },
  },
});
