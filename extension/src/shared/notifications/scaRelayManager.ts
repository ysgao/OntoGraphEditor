import * as vscode from 'vscode';
import { startScaRelay } from './scaNotificationRelay';
import type { ScaRelayHandle } from './scaNotificationRelay';
import { emitNotification } from './notificationBus';
import { fetchAccountDetails } from '../actions/accountDetails';
import { authoringServicesEndpoint } from '../actions/taskContext';

/**
 * Owns the singleton STOMP relay independently of AuthoringPanel, so it stays connected whenever
 * the extension is active — including when authoring-cli is the only thing talking to us and no
 * Authoring Workbench panel has ever been opened. See root CLAUDE.md's authoring-cli section on
 * why the CLI can't depend on a panel being open.
 */
let handle: ScaRelayHandle | undefined;

/** (Re)starts the relay from the current cookie/config. No-op (after stopping any previous
 * connection) if there's no cookie or the IMS account lookup fails — e.g. not signed in yet. Call
 * whenever the cookie might have changed: at activation and after pasteCookie/importChromeCookies. */
export async function refreshScaRelay(context: vscode.ExtensionContext): Promise<void> {
  handle?.stop();
  handle = undefined;

  const cookie = (await context.secrets.get('imsSessionCookie')) ?? '';
  if (!cookie) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const imsEndpoint = cfg.get<string>('imsEndpoint', 'https://uat-snowstorm.ihtsdotools.org/');

  const accountDetails = await fetchAccountDetails(imsEndpoint, cookie);
  const login = (accountDetails as { login?: string } | null)?.login;
  if (!login) {
    console.warn('[OntoGraph] scaRelayManager: no login resolved — not starting the SCA notification relay.');
    return;
  }

  handle = startScaRelay({
    authoringServicesEndpoint: authoringServicesEndpoint(),
    cookie,
    login,
    onNotification: emitNotification,
  });
}

export function stopScaRelay(): void {
  handle?.stop();
  handle = undefined;
}
