import * as vscode from 'vscode';
import { AuthoringPanel } from './authoringPanel';
import { LocalProxy } from './localProxy';
import { imsLogin } from './imsAuth';
import { readChromeCookiesForHost, cookiesToHeader } from './chromeCookies';
import { IpcMessage, isConceptFocus, isGraphNodeSelect } from './ipcMessages';

let proxy: LocalProxy | null = null;

export async function activate(context: vscode.ExtensionContext) {
  proxy = await startProxy(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.openAuthoring', () => {
      AuthoringPanel.createOrShow(context, proxy!);
    }),
    vscode.commands.registerCommand('ontographEditor.openGraph', () => {
      vscode.commands.executeCommand('ontograph.openGraph').then(undefined, () => {
        vscode.window.showWarningMessage(
          'OntoGraph: OntoGraph-lite is not installed or not activated.'
        );
      });
    }),
    vscode.commands.registerCommand('ontographEditor.ipcRoute', (message: IpcMessage) => {
      if (isConceptFocus(message)) {
        const iri = `http://snomed.info/id/${message.payload.id}`;
        vscode.commands.executeCommand('ontograph.focusEntity', { iri, fromIpc: true }).then(undefined, () => {});
      } else if (isGraphNodeSelect(message)) {
        AuthoringPanel.postMessage(message);
      }
    }),
    vscode.commands.registerCommand('ontographEditor.signIn', () => signIn(context)),
    vscode.commands.registerCommand('ontographEditor.pasteCookie', () => pasteCookie(context)),
    vscode.commands.registerCommand('ontographEditor.importChromeCookies', () => importChromeCookies(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ontographEditor')) {
        restartProxy(context);
      }
    })
  );
}

export function deactivate() {
  proxy?.stop();
}

async function signIn(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');

  const username = await vscode.window.showInputBox({
    prompt: `IMS username for ${imsEndpoint}`,
    placeHolder: 'username',
    ignoreFocusOut: true,
  });
  if (!username) { return; }

  const password = await vscode.window.showInputBox({
    prompt: 'IMS password',
    placeHolder: 'password',
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) { return; }

  const cookie = await imsLogin(imsEndpoint, username, password);
  if (!cookie) {
    vscode.window.showErrorMessage(
      'OntoGraph: IMS sign-in failed. Check Debug Console for details, or use "Set IMS Session Cookie" instead.'
    );
    return;
  }

  await context.secrets.store('imsSessionCookie', cookie);
  proxy?.updateSessionCookie(cookie);
  console.log(`[OntoGraph] signIn stored cookie: ${cookie.slice(0, 40)}…  (${cookie.length} chars)`);
  AuthoringPanel.reinitialize();
  vscode.window.showInformationMessage('OntoGraph: Signed in to IMS.');
}

async function pasteCookie(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');

  const value = await vscode.window.showInputBox({
    prompt: `Paste the full Cookie header from a working browser request to ${imsEndpoint}auth (DevTools → Network → /auth → Request Headers → Cookie)`,
    placeHolder: 'iam_session=...; XSRF-TOKEN=...',
    ignoreFocusOut: true,
  });
  if (!value || !value.trim()) { return; }

  const trimmed = value.trim().replace(/[\r\n]+/g, '');
  const cookie = trimmed.includes('=') ? trimmed : 'iam_session=' + trimmed;

  await context.secrets.store('imsSessionCookie', cookie);
  proxy?.updateSessionCookie(cookie);
  console.log(`[OntoGraph] pasteCookie stored: ${cookie.slice(0, 40)}…  (${cookie.length} chars)`);
  AuthoringPanel.reinitialize();
  vscode.window.showInformationMessage('OntoGraph: IMS session cookie stored. Reloading panel…');
}

async function importChromeCookies(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');
  let host: string;
  try { host = new URL(imsEndpoint).hostname; } catch {
    vscode.window.showErrorMessage(`OntoGraph: invalid imsEndpoint: ${imsEndpoint}`);
    return;
  }
  // Match the bare host plus the parent domain (cookies are often set on .ihtsdotools.org)
  const parentDomain = host.split('.').slice(-2).join('.');

  try {
    const cookies = await readChromeCookiesForHost(parentDomain);
    if (!cookies.length) {
      vscode.window.showWarningMessage(
        `OntoGraph: no Chrome cookies found for *${parentDomain}*. Sign in to ${imsEndpoint} in Chrome first.`
      );
      return;
    }
    // Prefer cookies whose host_key matches the IMS host directly, fall back to others.
    const matching = cookies.filter(c =>
      c.host === host || c.host === '.' + host || c.host === '.' + parentDomain || c.host === parentDomain
    );
    const chosen = matching.length ? matching : cookies;
    const cookieHeader = cookiesToHeader(chosen);
    console.log(`[OntoGraph] Imported ${chosen.length} cookie(s) from Chrome — header length=${cookieHeader.length}`);
    console.log('[OntoGraph] cookie names:', chosen.map(c => `${c.name}@${c.host}`).join(', '));

    await context.secrets.store('imsSessionCookie', cookieHeader);
    proxy?.updateSessionCookie(cookieHeader);
    AuthoringPanel.reinitialize();
    vscode.window.showInformationMessage(
      `OntoGraph: Imported ${chosen.length} cookie(s) from Chrome. Reloading panel…`
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[OntoGraph] importChromeCookies failed:', e);
    vscode.window.showErrorMessage('OntoGraph: Chrome cookie import failed — ' + msg);
  }
}

async function startProxy(context: vscode.ExtensionContext): Promise<LocalProxy> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const endpoint = cfg.get<string>('authoringServicesEndpoint', 'https://dev-snowstorm.ihtsdotools.org/authoring-services/');
  const cookie = (await context.secrets.get('imsSessionCookie')) ?? '';
  const p = new LocalProxy(endpoint, cookie);
  const port = await p.start();
  console.log(`[OntoGraph] Proxy started on localhost:${port} → ${endpoint}`);
  return p;
}

async function restartProxy(context: vscode.ExtensionContext): Promise<void> {
  proxy?.stop();
  proxy = await startProxy(context);
  AuthoringPanel.updateProxy(proxy);
  AuthoringPanel.reinitialize();
}
