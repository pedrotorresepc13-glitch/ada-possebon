import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    // Cada arquivo cria sua propria instancia PGlite (PostgreSQL em WASM).
    // Executar os arquivos em paralelo causou falhas no Windows;
    // a suite completa passou (120/120) com --no-file-parallelism.
    fileParallelism: false,
    pool: 'forks'
  }
});
