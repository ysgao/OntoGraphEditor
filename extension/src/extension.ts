import * as vscode from 'vscode';
import { AuthoringPanel } from './authoringPanel';
import { LocalProxy } from './localProxy';
import { imsLogin } from './imsAuth';
import { readChromeCookiesForHost, cookiesToHeader } from './chromeCookies';
import { IpcMessage, isConceptFocus, isGraphNodeSelect } from './ipcMessages';
import { JreDetector, JRE_DOWNLOAD_URL } from './jreDetector';

let proxy: LocalProxy | null = null;
let pendingFocusIri: string | undefined;

function isGraphTabOpen(): boolean {
  return vscode.window.tabGroups.all
    .flatMap(g => g.tabs)
    .some(t => t.input instanceof vscode.TabInputWebview &&
               (t.input as vscode.TabInputWebview).viewType.toLowerCase().includes('ontograph'));
}

function isGraphTabActive(): boolean {
  return vscode.window.tabGroups.all
    .flatMap(g => g.tabs)
    .some(t => t.isActive &&
               t.input instanceof vscode.TabInputWebview &&
               (t.input as vscode.TabInputWebview).viewType.toLowerCase().includes('ontograph'));
}

export async function activate(context: vscode.ExtensionContext) {
  void ensureOntoGraphLiteInstalled(context);

  const jre = new JreDetector().detect();
  if (!jre.compatible) {
    const msg = jre.found
      ? `OntoGraph Editor requires Java 21+. Found Java ${jre.major}.`
      : 'OntoGraph Editor requires Java 21 or later.';
    vscode.window.showErrorMessage(msg, 'Install Java').then(selection => {
      if (selection === 'Install Java') {
        vscode.env.openExternal(vscode.Uri.parse(JRE_DOWNLOAD_URL));
      }
    });
  }

  proxy = await startProxy(context);

  // When the ontograph tab becomes active, deliver any pending concept focus.
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      if (!pendingFocusIri) { return; }
      for (const tab of e.changed) {
        if (tab.isActive &&
            tab.input instanceof vscode.TabInputWebview &&
            (tab.input as vscode.TabInputWebview).viewType.toLowerCase().includes('ontograph')) {
          const iri = pendingFocusIri;
          pendingFocusIri = undefined;
          vscode.commands.executeCommand('ontograph.focusEntity', { iri, fromIpc: true }).then(undefined, () => {});
          break;
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.openAuthoring', () => {
      AuthoringPanel.createOrShow(context, proxy!);
    }),
    vscode.commands.registerCommand('ontographEditor.openGraph', () => {
      // Open graph in the same column as the authoring panel so both appear as tabs.
      // preserveFocus keeps authoring as the active tab after graph opens.
      const col = AuthoringPanel.getViewColumn() ?? vscode.ViewColumn.Active;
      vscode.commands.executeCommand('ontograph.openGraph', { viewColumn: col, preserveFocus: true }).then(() => {
        // ontograph.openGraph may steal focus despite preserveFocus — restore authoring.
        AuthoringPanel.reveal(false);
      }, () => {
        vscode.window.showWarningMessage(
          'OntoGraph-lite is not yet active. Installing…'
        );
        void ensureOntoGraphLiteInstalled(context);
      });
    }),
    vscode.commands.registerCommand('ontographEditor.ipcRoute', (message: IpcMessage) => {
      if (isConceptFocus(message)) {
        if (!isGraphTabOpen()) { return; }
        const iri = `http://snomed.info/id/${message.payload.id}`;
        if (isGraphTabActive()) {
          // Ontograph is the focused tab — sync immediately, no focus change needed.
          vscode.commands.executeCommand('ontograph.focusEntity', { iri, fromIpc: true }).then(undefined, () => {});
        } else {
          // Ontograph is open but hidden — store IRI, deliver when user switches to it.
          // Do NOT call focusEntity now: it would reveal the panel and steal focus.
          pendingFocusIri = iri;
        }
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

async function ensureOntoGraphLiteInstalled(context: vscode.ExtensionContext): Promise<void> {
  if (vscode.extensions.getExtension('ysgao.ontograph-lite')) { return; }
  const vsixUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'ontograph-lite.vsix');
  await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);
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
