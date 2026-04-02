import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The @angular/build:unit-test builder picks up spec files automatically;
    // this config sets global options for the Vitest runner.
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/app/**/*.ts'],
      exclude: ['src/app/**/*.spec.ts'],
    },
  },
});
