import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

// Empacota a API em um único módulo ESM para execução persistente (systemd) com Node 22+.
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/cli/migrate.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'bundle',
  external: ['@electric-sql/pglite', 'pg', 'pg-native', 'fastify', '@fastify/*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info'
});
// Em produção, ADA_ROOT aponta para a raiz do release (db/migrations e apps/web/dist).
