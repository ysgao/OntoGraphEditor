import * as vscode from 'vscode';
import { AuthoringPanel } from './authoringPanel';
import { LocalProxy } from '../shared/localProxy';
import { readChromeCookiesForHost, cookiesToHeader } from './chromeCookies';

export function activate(context: vscode.ExtensionContext, proxy: LocalProxy): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.openAuthoring', () => {
      AuthoringPanel.createOrShow(context, proxy);
    }),
    vscode.commands.registerCommand('ontographEditor.importChromeCookies', () => {
      importChromeCookies(context, proxy);
    }),
    vscode.commands.registerCommand('ontographEditor.pasteCookie', () => {
      vscode.window.showInputBox({
        prompt: 'Paste your IMS session cookie',
        ignoreFocusOut: true,
      }).then(async (cookie) => {
        if (cookie) {
          await context.secrets.store('imsSessionCookie', cookie);
          proxy.updateSessionCookie(cookie);
          AuthoringPanel.reinitialize();
          vscode.window.showInformationMessage('Cookie saved and session updated.');
        }
      });
    })
  );
}

async function importChromeCookies(context: vscode.ExtensionContext, proxy: LocalProxy): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://dev-snowstorm.ihtsdotools.org/');
  let host: string;
  try { host = new URL(imsEndpoint).hostname; } catch {
    vscode.window.showErrorMessage(`OntoGraph: invalid imsEndpoint: ${imsEndpoint}`);
    return;
  }
  const parentDomain = host.split('.').slice(-2).join('.');

  try {
    const cookies = await readChromeCookiesForHost(parentDomain);
    if (!cookies.length) {
      vscode.window.showWarningMessage(
        `OntoGraph: no Chrome cookies found for *${parentDomain}*. Sign in to ${imsEndpoint} in Chrome first.`
      );
      return;
    }
    const matching = cookies.filter(c =>
      c.host === host || c.host === '.' + host || c.host === '.' + parentDomain || c.host === parentDomain
    );
    const chosen = matching.length ? matching : cookies;
    const cookieHeader = cookiesToHeader(chosen);
    console.log(`[OntoGraph] Imported ${chosen.length} cookie(s) from Chrome — header length=${cookieHeader.length}`);
    console.log('[OntoGraph] cookie names:', chosen.map(c => `${c.name}@${c.host}`).join(', '));

    await context.secrets.store('imsSessionCookie', cookieHeader);
    proxy.updateSessionCookie(cookieHeader);
    AuthoringPanel.reinitialize();
    vscode.window.showInformationMessage('Cookies imported from Chrome.');
  } catch (e) {
    const msg = (e instanceof Error) ? e.message : String(e);
    console.error('[OntoGraph] importChromeCookies failed:', e);
    vscode.window.showErrorMessage('OntoGraph: Chrome cookie import failed — ' + msg);
  }
}
