import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Auto-links the headless authoring-cli (bundled into dist/cli/ by esbuild.mjs) as a global
 * `authoring-cli` command via `npm link`, so users get a working command the moment the
 * extension activates — no manual clone/build/link step. The bundled package.json is
 * deliberately dependency-free (see esbuild.mjs) so `npm link`'s install step is a no-op and
 * this stays fully offline-safe.
 *
 * cli/'s TypeScript source is intentionally NOT shipped — only the compiled dist/ — so the
 * source of truth stays in the repo and users can't drift a locally-edited copy out of sync
 * with whatever extension version they're running.
 */

const GLOBAL_STATE_KEY = 'authoringCliLinkedVersion';
const NPM_LINK_TIMEOUT_MS = 30000;

let outputChannel: vscode.OutputChannel | undefined;
let warnedThisSession = false;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('OntoGraph CLI Setup');
  }
  return outputChannel;
}

function getBundledCliPath(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli').fsPath;
}

function readBundledVersion(bundledPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(bundledPath, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

async function runNpmLink(bundledPath: string, log: vscode.OutputChannel): Promise<void> {
  log.appendLine(`[${new Date().toISOString()}] Running "npm link" in ${bundledPath}`);
  const { stdout, stderr } = await execAsync('npm link --omit=dev --no-audit --no-fund', {
    cwd: bundledPath,
    timeout: NPM_LINK_TIMEOUT_MS,
  });
  if (stdout.trim()) {
    log.appendLine(stdout.trim());
  }
  if (stderr.trim()) {
    log.appendLine(stderr.trim());
  }
}

/**
 * @param force Bypass the version-match check and always relink — used by the manual
 * "OntoGraph: Set Up authoring-cli Command" command for troubleshooting.
 */
export async function ensureAuthoringCliLinked(context: vscode.ExtensionContext, force = false): Promise<void> {
  const log = getOutputChannel();
  const bundledPath = getBundledCliPath(context);

  if (!fs.existsSync(path.join(bundledPath, 'package.json'))) {
    log.appendLine('authoring-cli is not bundled in this build (missing dist/cli/package.json) — skipping.');
    return;
  }

  const bundledVersion = readBundledVersion(bundledPath);
  if (!bundledVersion) {
    log.appendLine('Could not read the bundled authoring-cli version — skipping.');
    return;
  }

  const linkedVersion = context.globalState.get<string>(GLOBAL_STATE_KEY);
  const isFirstLink = linkedVersion === undefined;

  if (!force && linkedVersion === bundledVersion) {
    log.appendLine(`authoring-cli ${bundledVersion} already linked — nothing to do.`);
    return;
  }

  try {
    await runNpmLink(bundledPath, log);
    await context.globalState.update(GLOBAL_STATE_KEY, bundledVersion);
    log.appendLine(`authoring-cli ${bundledVersion} linked successfully.`);

    if (isFirstLink) {
      vscode.window.showInformationMessage('OntoGraph: "authoring-cli" is now available as a global command.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`[error] Failed to link authoring-cli: ${message}`);

    if (force || !warnedThisSession) {
      warnedThisSession = true;
      void vscode.window
        .showWarningMessage(
          `OntoGraph: could not set up the "authoring-cli" command automatically (${message}). ` +
            `Run manually: cd "${bundledPath}" && npm link`,
          'Show Log'
        )
        .then((choice) => {
          if (choice === 'Show Log') {
            log.show();
          }
        });
    }
  }
}
