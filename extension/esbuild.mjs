import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

const production = process.argv.includes('--minify');
const watch = process.argv.includes('--watch');

const baseConfig = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

// --- Node.js targets (Extension Host, Workers, Servers) ---
const nodeConfig = {
  ...baseConfig,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

// 1. Main Extension Host
const extensionBuild = esbuild.build({
  ...nodeConfig,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
});

// 2. OntoGraph-lite Parser Worker
const parserWorkerBuild = esbuild.build({
  ...nodeConfig,
  entryPoints: ['../apps/OntoGraph-lite/src/parser/parserWorker.ts'],
  outfile: 'dist/parserWorker.js',
});

// 3. OntoGraph-lite Language Server
const serverBuild = esbuild.build({
  ...nodeConfig,
  entryPoints: ['../apps/OntoGraph-lite/src/lsp/server/server.ts'],
  outfile: 'dist/server.js',
});

// --- Browser targets (Webviews) ---
const browserConfig = {
  ...baseConfig,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
};

// 4-7. Webviews (single build with splitting — shares codemirror and other common deps)
const webviewBuild = esbuild.build({
  ...browserConfig,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  entryPoints: {
    'graph-webview':         '../apps/OntoGraph-lite/webview-src/graph/GraphViewApp.ts',
    'entity-editor-webview': '../apps/OntoGraph-lite/webview-src/entity-editor/EntityEditorApp.ts',
    'sparql-editor-webview': '../apps/OntoGraph-lite/webview-src/sparql-editor/SparqlEditorApp.ts',
    'dl-query-webview':      '../apps/OntoGraph-lite/webview-src/dl-query/DLQueryApp.ts',
  },
  chunkNames: 'chunks/[hash]',
});

await Promise.all([
  extensionBuild,
  parserWorkerBuild,
  serverBuild,
  webviewBuild,
]).catch(() => process.exit(1));

// Post-build: Copy Java reasoner server JAR
const jarSrc = path.resolve('../apps/OntoGraph-lite/java-server/target/onto-reasoner-server.jar');
const jarDest = path.resolve('dist/java-server/onto-reasoner-server.jar');
if (fs.existsSync(jarSrc)) {
  fs.mkdirSync(path.dirname(jarDest), { recursive: true });
  fs.copyFileSync(jarSrc, jarDest);
  console.log(`Copied reasoner JAR → dist/java-server/`);
} else {
  console.warn(`[warn] Reasoner JAR not found at ${jarSrc} — classification will not work`);
}

// Post-build: Copy Authoring UI assets if they exist
const authoringUiDist = path.resolve('../apps/authoring-ui-vscode/dist');
const targetAuthoringDir = path.resolve('dist/authoring');

if (fs.existsSync(authoringUiDist)) {
  console.log(`Copying Authoring UI assets from ${authoringUiDist} to ${targetAuthoringDir}`);
  if (fs.existsSync(targetAuthoringDir)) {
    fs.rmSync(targetAuthoringDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetAuthoringDir, { recursive: true });
  fs.cpSync(authoringUiDist, targetAuthoringDir, { recursive: true });
}
