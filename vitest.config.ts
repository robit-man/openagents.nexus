import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    // Harness tests spin up real libp2p nodes and take 30+ seconds each;
    // give the full suite a generous per-test timeout.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
