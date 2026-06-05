import * as vscode from 'vscode';
import { AuthoringPanel } from './authoringPanel';
import { LocalProxy } from '../shared/localProxy';

export function activate(context: vscode.ExtensionContext, proxy: LocalProxy): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.openAuthoring', () => {
      AuthoringPanel.createOrShow(context, proxy);
    })
  );
}
