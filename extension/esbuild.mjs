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
  // vscode is host-provided. bufferutil/utf-8-validate are ws's optional native accelerators,
  // conditionally required inside a try/catch (see node_modules/ws/lib/{buffer-util,validation}.js)
  // and never installed here — marking them external avoids an esbuild "could not resolve" error
  // for a require() that's fine to fail at runtime (ws falls back to its pure-JS implementation).
  external: ['vscode', 'bufferutil', 'utf-8-validate'],
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

// 4-8. Webviews (single build with splitting — shares codemirror and other common deps)
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
    'uml-diagram-webview':   '../apps/OntoGraph-lite/webview-src/uml/UmlDiagramApp.ts',
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

// Post-build: Bundle the headless authoring-cli (cli/) so the extension can auto `npm link`
// it on activation — see extension/src/shared/cliInstaller.ts. Only the compiled dist/ and a
// trimmed package.json ship (no devDependencies, no TS source): `npm link` with no args runs
// an install step first, and a dependency-free package.json keeps that step a no-op — fully
// offline-safe. Shipping the real cli/package.json (with typescript/@types/node as
// devDependencies) would risk that install step trying to fetch them on every user's machine.
const cliDist = path.resolve('../cli/dist');
const cliPackageJsonSrc = path.resolve('../cli/package.json');
const targetCliDir = path.resolve('dist/cli');

if (fs.existsSync(cliDist) && fs.existsSync(cliPackageJsonSrc)) {
  console.log(`Bundling authoring-cli from ${cliDist} to ${targetCliDir}`);
  if (fs.existsSync(targetCliDir)) {
    fs.rmSync(targetCliDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetCliDir, { recursive: true });
  fs.cpSync(cliDist, path.join(targetCliDir, 'dist'), { recursive: true });

  // cli/skills/ ships alongside dist/ so authoring-cli's own usage output (see
  // cli/src/index.ts's resolveSkillPath()) can point AI agents at it — a portable Agent Skills
  // folder for the CLI itself, unrelated to this repo's own dev-time .claude/skills/ (if any).
  const cliSkills = path.resolve('../cli/skills');
  if (fs.existsSync(cliSkills)) {
    fs.cpSync(cliSkills, path.join(targetCliDir, 'skills'), { recursive: true });
  }

  const cliPackageJson = JSON.parse(fs.readFileSync(cliPackageJsonSrc, 'utf8'));
  const trimmedPackageJson = {
    name: cliPackageJson.name,
    version: cliPackageJson.version,
    private: true,
    bin: cliPackageJson.bin,
  };
  fs.writeFileSync(path.join(targetCliDir, 'package.json'), JSON.stringify(trimmedPackageJson, null, 2) + '\n');
} else {
  console.warn(`[warn] authoring-cli not built at ${cliDist} — run "npm run build:cli" first. authoring-cli will not be bundled.`);
}
