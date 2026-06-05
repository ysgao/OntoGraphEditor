/**
 * IPC message types for persisting authoring-ui display configuration.
 * Crosses the extension host ↔ webview bridge.
 */

export interface DisplayConfigChangeMessage {
  command: 'DISPLAY_CONFIG_CHANGE';
  /** Partial update — only changed fields required. */
  payload: Partial<DisplayConfig>;
}

export interface DisplayConfigInitMessage {
  command: 'DISPLAY_CONFIG_INIT';
  payload: DisplayConfig;
}

export interface DisplayConfig {
  /** Full userPreferences object as returned by accountService */
  userPreferences: Record<string, unknown>;
  schemaVersion: number;
}

export function isDisplayConfigChange(msg: unknown): msg is DisplayConfigChangeMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as DisplayConfigChangeMessage).command === 'DISPLAY_CONFIG_CHANGE'
  );
}
