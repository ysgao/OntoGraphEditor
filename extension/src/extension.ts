import * as vscode from 'vscode';
import { activate as activateAuthoring } from './authoring/activateAuthoring';
import { AuthoringPanel } from './authoring/authoringPanel';
import { activate as activateGraph } from './graph/activateGraph';
import { LocalProxy } from './shared/localProxy';
import { ControlServer } from './shared/controlServer';
import { removeSessionFile } from './shared/sessionFile';
import { IpcMessage, isConceptFocus, isGraphNodeSelect } from './shared/ipcMessages';
import { onNotification } from './shared/notifications/notificationBus';
import { stopScaRelay } from './shared/notifications/scaRelayManager';

let proxy: LocalProxy | null = null;
let controlServer: ControlServer | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('OntoGraph Editor (Unified) activating...');

  proxy = await startProxy(context);

  controlServer = await activateAuthoring(context, proxy);
  activateGraph(context);

  // Forward every SCA notification the relay (scaRelayManager.ts) receives into the Authoring
  // webview, if one happens to be open — a single, permanent subscription rather than something
  // AuthoringPanel manages itself, since the relay's lifetime is no longer tied to any panel.
  // AuthoringPanel.postMessage() already no-ops when no panel instance exists.
  onNotification((payload) => AuthoringPanel.postMessage({ command: 'SCA_NOTIFICATION', payload }));

  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.ipcRoute', (message: IpcMessage) => {
      if (isConceptFocus(message)) {
        // Handle concept focus by routing to OntoGraph-lite graph visualization
        vscode.commands.executeCommand('ontograph.focusEntity', { 
            iri: `http://snomed.info/id/${message.payload.id}`, 
            fromIpc: true 
        }).then(undefined, () => {});
      } else if (isGraphNodeSelect(message)) {
        // Handle graph node selection by routing to Authoring UI
        AuthoringPanel.postMessage(message);
      }
    })
  );
}

export function deactivate() {
  proxy?.stop();
  controlServer?.stop();
  stopScaRelay();
  removeSessionFile();
}

async function startProxy(context: vscode.ExtensionContext): Promise<LocalProxy> {
  const cfg = vscode.workspace.getConfiguration('ontographEditor');
  const endpoint = cfg.get<string>('authoringServicesEndpoint', 'https://uat-snowstorm.ihtsdotools.org/authoring-services/');
  const cookie = (await context.secrets.get('imsSessionCookie')) ?? '';
  const p = new LocalProxy(endpoint, cookie);
  const port = await p.start();
  console.log(`[OntoGraph] Proxy started on localhost:${port} → ${endpoint}`);
  return p;
}
