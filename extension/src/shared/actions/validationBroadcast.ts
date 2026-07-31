import { AuthoringPanel } from '../../authoring/authoringPanel';
import type { ValidationResultItem } from '../ipcMessages';

/**
 * Pushes save-time validation messages into the Authoring webview, if one has ever been opened
 * this session, so a human watching the same task sees the same warnings/errors a headless
 * authoring-cli write just produced — mirroring what the interactive editor shows after a manual
 * save with validate=true. Deliberately does NOT gate on the panel being the focused tab: with
 * retainContextWhenHidden the webview stays alive in the background, so an open-but-unfocused
 * panel should still pick up the update and have it ready when the human switches back.
 * AuthoringPanel.postMessage() itself already no-ops when no panel instance exists at all.
 */
export function broadcastValidationResults(conceptId: string, validationResults: unknown): void {
  if (!Array.isArray(validationResults) || validationResults.length === 0) {
    return;
  }
  AuthoringPanel.postMessage({
    command: 'VALIDATION_RESULTS',
    payload: { conceptId, validationResults: validationResults as ValidationResultItem[] },
  });
}
