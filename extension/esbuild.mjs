import * as esbuild from 'esbuild';

const production = process.argv.includes('--minify');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  target: 'node18',
  platform: 'node',
  external: ['vscode'],
  outfile: 'dist/extension.js',
});
