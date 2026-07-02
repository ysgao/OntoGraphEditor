import * as vscode from 'vscode';

// Decoration applied to lines added or modified by entity create/edit sync.
// Display-only: it does not affect file content or OWL semantics — it only marks
// what just changed, styled like VS Code's "modified" gutter indicator
// (left border + overview ruler).
export const syncHighlightDecoration = vscode.window.createTextEditorDecorationType({
  borderStyle: 'none none none solid',
  borderWidth: '0 0 0 3px',
  borderColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  isWholeLine: true,
});

// Track the URI whose lines are currently decorated so we can clear them on the
// next sync or when the entity editor panel is closed.
let decoratedUri: string | undefined;

/** Highlight the given ranges in any visible editor for `uri`, clearing prior highlights. */
export function highlightSyncedRanges(uri: vscode.Uri, ranges: vscode.Range[]): void {
  // Clear any decoration from a previous sync (possibly on a different document).
  clearSyncHighlight();

  if (ranges.length === 0) { return; }
  decoratedUri = uri.toString();
  const editors = vscode.window.visibleTextEditors.filter(
    editor => editor.document.uri.toString() === uri.toString(),
  );
  for (const editor of editors) {
    editor.setDecorations(syncHighlightDecoration, ranges);
  }
}

/** Remove any active sync highlight. */
export function clearSyncHighlight(): void {
  if (!decoratedUri) { return; }
  const target = decoratedUri;
  decoratedUri = undefined;
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === target) {
      editor.setDecorations(syncHighlightDecoration, []);
    }
  }
}
