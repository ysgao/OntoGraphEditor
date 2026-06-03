import * as vscode from 'vscode';
import { AuthoringPanel } from './authoringPanel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('ontographEditor.openAuthoring', () => {
      AuthoringPanel.createOrShow(context);
    })
  );
}

export function deactivate() {}
