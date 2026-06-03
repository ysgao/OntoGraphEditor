/**
 * Contract interface defining communication methods for the custom VsCodeService
 * in the Angular client application.
 */
export interface IVsCodeService {
  /**
   * Acquires the VS Code Webview API instance safely.
   * Returns null if running in standard browser/standalone mode.
   */
  getVsCodeApi(): any;

  /**
   * Sends a structured JSON message to the VS Code Extension Host.
   * 
   * @param command Name of the command event to trigger.
   * @param payload Accompanying data payload.
   */
  postMessage(command: string, payload: any): void;

  /**
   * Persists the current state within the webview frame.
   * This state survives tab switches and hide/reveal cycles.
   * 
   * @param state The state object matching the persisted state schema.
   */
  setState(state: any): void;

  /**
   * Retrieves the previously persisted state from the webview context.
   */
  getState(): any;
}
