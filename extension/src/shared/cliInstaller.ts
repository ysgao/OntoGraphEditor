import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  UNIX_SHIM_PATH,
  WINDOWS_SHIM_PATH,
  ensureUnixPathConfigured,
  ensureWindowsPathConfigured,
  writeShimFiles,
} from './cliPathConfig';

const execAsync = promisify(exec);

/**
 * Auto-installs the headless authoring-cli (bundled into dist/cli/ by esbuild.mjs) as a global
 * `authoring-cli` command, so users get a working command the moment the extension activates —
 * no manual clone/build/link step.
 *
 * cli/'s TypeScript source is intentionally NOT shipped — only the compiled dist/ — so the
 * source of truth stays in the repo and users can't drift a locally-edited copy out of sync
 * with whatever extension version they're running.
 *
 * PATH caveat and design: this used to run `npm link`, but that resolves whatever Node/npm the
 * extension host process sees, which routinely differs from the user's actual terminal Node/npm
 * (nvm/volta-managed installs, custom npm prefixes, or a VS Code fork bundling its own Node) —
 * `npm link` can report success while linking into a global bin dir that's never on the user's
 * terminal PATH. To avoid depending on any npm/Node match at all, `cliPathConfig.ts` instead
 * hand-writes a shim to a fixed, version-independent location (~/.ontograph-editor/bin/authoring-cli)
 * and manages PATH itself (shell rc files / Windows user env var) — see that module for detail.
 * `resolveShellPath()`/`verifyOnPath()` below are now purely diagnostic: a freshly spawned login
 * shell genuinely re-reads rc files from disk, so they can confirm the PATH setup took effect
 * immediately, even though the *current* extension-host process's own env can't change.
 */

const GLOBAL_STATE_KEY = 'authoringCliLinkedVersion';
const SHELL_PATH_TIMEOUT_MS = 10000;
const PATH_MARKER = '__ONTOGRAPH_PATH__';

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

/**
 * Asks the user's real login+interactive shell for its PATH — used only to verify our own
 * shim/rc-file setup actually took effect, never to decide where to install anything.
 * Returns undefined on Windows (no cheap "fresh shell" equivalent — a child process here would
 * just inherit this extension host's own env, not re-read the registry) or if the shell can't be
 * queried in time.
 */
async function resolveShellPath(log: vscode.OutputChannel): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return undefined;
  }
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout } = await execAsync(`${shell} -ilc 'echo ${PATH_MARKER}:$PATH'`, {
      timeout: SHELL_PATH_TIMEOUT_MS,
    });
    const line = stdout.split('\n').find((l) => l.includes(PATH_MARKER));
    const resolved = line?.split(`${PATH_MARKER}:`)[1]?.trim();
    if (resolved) {
      log.appendLine(`Resolved login-shell PATH via ${shell}.`);
      return resolved;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`[warn] Could not resolve login-shell PATH via ${shell} (${message}).`);
  }
  return undefined;
}

type VerifyResult =
  | { status: 'matches' }
  | { status: 'shadowed'; resolvedPath: string }
  | { status: 'not-found' };

/**
 * Confirms `authoring-cli` doesn't just resolve to *something* on PATH, but resolves to the exact
 * shim we wrote — "some command by this name works" isn't good enough, since another tool
 * (a leftover manual `npm link`, or some other installer) squatting on the same name earlier in
 * PATH would otherwise go undetected and silently run instead of this extension's CLI.
 */
async function verifyOnPath(
  shellPath: string | undefined,
  expectedShimPath: string,
  log: vscode.OutputChannel
): Promise<VerifyResult> {
  try {
    const { stdout } = await execAsync('command -v authoring-cli', {
      timeout: SHELL_PATH_TIMEOUT_MS,
      env: shellPath ? { ...process.env, PATH: shellPath } : process.env,
    });
    const resolved = stdout.trim();
    if (!resolved) {
      return { status: 'not-found' };
    }
    log.appendLine(`authoring-cli resolves on PATH at: ${resolved}`);
    if (path.resolve(resolved) === path.resolve(expectedShimPath)) {
      return { status: 'matches' };
    }
    return { status: 'shadowed', resolvedPath: resolved };
  } catch {
    // command -v exits non-zero when not found.
    return { status: 'not-found' };
  }
}

function warnSetupIncomplete(log: vscode.OutputChannel, force: boolean, detail: string): void {
  if (!force && warnedThisSession) {
    return;
  }
  warnedThisSession = true;
  void vscode.window
    .showWarningMessage(`OntoGraph: "authoring-cli" setup may be incomplete. ${detail}`, 'Show Log')
    .then((choice) => {
      if (choice === 'Show Log') {
        log.show();
      }
    });
}

async function reportStatus(
  log: vscode.OutputChannel,
  expectedShimPath: string,
  justInstalled: boolean,
  force: boolean
): Promise<void> {
  if (process.platform === 'win32') {
    if (justInstalled || force) {
      vscode.window.showInformationMessage(
        'OntoGraph: "authoring-cli" is set up. Open a new terminal (Command Prompt/PowerShell) to use it.'
      );
    }
    return;
  }

  const shellPath = await resolveShellPath(log);
  const result = await verifyOnPath(shellPath, expectedShimPath, log);

  if (result.status === 'matches') {
    if (justInstalled || force) {
      vscode.window.showInformationMessage(
        'OntoGraph: "authoring-cli" is now available as a global command. Open a new terminal to use it.'
      );
    }
    return;
  }

  if (result.status === 'shadowed') {
    warnSetupIncomplete(
      log,
      force,
      `Wrote ${expectedShimPath}, but "authoring-cli" on your PATH still resolves to a different ` +
        `program first: ${result.resolvedPath}. Remove or reorder whatever put that one earlier on ` +
        'PATH (an old manual "npm link", another tool by the same name), or move ' +
        `"${path.dirname(expectedShimPath)}" earlier in your shell's PATH.`
    );
    return;
  }

  warnSetupIncomplete(
    log,
    force,
    `Wrote ${expectedShimPath} and updated your shell rc files, but it still doesn't ` +
      'resolve in a fresh shell. Check that ~/.zshrc / ~/.bashrc / ~/.bash_profile / ~/.profile ' +
      'contain the "ontograph authoring-cli" marker block, or rerun ' +
      '"OntoGraph: Set Up authoring-cli Command".'
  );
}

/**
 * @param force Bypass the version-match check and always rewrite the shim/PATH setup — used by
 * the manual "OntoGraph: Set Up authoring-cli Command" command for troubleshooting.
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
  const versionChanged = linkedVersion !== bundledVersion;
  // The bundled CLI's own version (used above) only bumps when its business logic changes, not
  // when *this install mechanism* does — e.g. today's switch from `npm link` to a hand-written
  // shim shipped under the same "1.0.0", so anyone who'd already activated a prior version of
  // this extension would have `linkedVersion === bundledVersion` and never get the new shim
  // written at all. Checking the shim's actual on-disk presence closes that gap generically for
  // any future mechanism change, and self-heals if a user (or something else) deletes it later.
  const shimMissing = !fs.existsSync(process.platform === 'win32' ? WINDOWS_SHIM_PATH : UNIX_SHIM_PATH);
  const needsShimWrite = force || versionChanged || shimMissing;

  try {
    if (needsShimWrite) {
      const entryJsPath = path.join(bundledPath, 'dist', 'index.js');
      const { shimPath } = writeShimFiles(entryJsPath, process.execPath);
      await context.globalState.update(GLOBAL_STATE_KEY, bundledVersion);
      log.appendLine(`authoring-cli ${bundledVersion} shim written to ${shimPath}.`);
    } else {
      log.appendLine(`authoring-cli ${bundledVersion} shim already up to date.`);
    }

    if (process.platform === 'win32') {
      const { ran } = await ensureWindowsPathConfigured();
      log.appendLine(ran ? 'Updated the Windows user PATH environment variable.' : 'Windows user PATH already configured.');
    } else {
      const { updatedFiles } = ensureUnixPathConfigured();
      log.appendLine(
        updatedFiles.length > 0
          ? `Updated PATH setup in: ${updatedFiles.join(', ')}`
          : 'Shell rc files already configured.'
      );
    }

    const expectedShimPath = process.platform === 'win32' ? WINDOWS_SHIM_PATH : UNIX_SHIM_PATH;
    await reportStatus(log, expectedShimPath, needsShimWrite, force);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`[error] Failed to set up authoring-cli: ${message}`);

    if (force || !warnedThisSession) {
      warnedThisSession = true;
      void vscode.window
        .showWarningMessage(
          `OntoGraph: could not set up the "authoring-cli" command automatically (${message}). ` +
            'See the "OntoGraph CLI Setup" output channel for details.',
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
