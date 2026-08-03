import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scoped to src/shared/ only — src/graph/**/*.test.ts mirrors the OntoGraph-lite submodule's
    // own suite and is exercised there (apps/OntoGraph-lite's own `npm test`), not from here.
    include: ['src/shared/**/*.test.ts'],
    environment: 'node',
  },
});
