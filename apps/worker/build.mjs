import { build } from 'esbuild';

await build({
  entryPoints: { worker: 'src/worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['@electric-sql/pglite', 'pg', 'pg-native', 'fastify', '@fastify/*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info'
});
