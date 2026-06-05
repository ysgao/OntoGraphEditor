import * as vscode from 'vscode';
import type { DisplayConfig } from './displayConfigMessages';

export type { DisplayConfig };

export const DISPLAY_CONFIG_STORAGE_KEY = 'ontograph.authoringUi.displayConfig';
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  userPreferences: {
    appView: 'sca-default',
    colourScheme: 'sca-colours',
    layout: {
      editDefault: {
        name: 'editDefault',
        width: 12,
        children: [
          { name: 'sidebar', width: 3 },
          {
            name: 'modelsAndConcepts',
            width: 9,
            children: [
              { name: 'models', width: 6 },
              { name: 'concepts', width: 6 },
            ],
          },
        ],
      },
    },
  },
  schemaVersion: CURRENT_SCHEMA_VERSION,
};

export interface IDisplayConfigStore {
  load(): DisplayConfig;
  save(partial: Partial<DisplayConfig>): void;
}

export class DisplayConfigStore implements IDisplayConfigStore {
  constructor(private readonly globalState: vscode.Memento) {}

  load(): DisplayConfig {
    try {
      const stored = this.globalState.get<DisplayConfig>(DISPLAY_CONFIG_STORAGE_KEY);
      if (!stored || stored.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        return { ...DEFAULT_DISPLAY_CONFIG };
      }
      return stored;
    } catch {
      return { ...DEFAULT_DISPLAY_CONFIG };
    }
  }

  save(partial: Partial<DisplayConfig>): void {
    try {
      const current = this.load();
      const updated: DisplayConfig = { ...current, ...partial, schemaVersion: CURRENT_SCHEMA_VERSION };
      void this.globalState.update(DISPLAY_CONFIG_STORAGE_KEY, updated);
    } catch (err) {
      console.warn('[OntoGraph] DisplayConfigStore.save failed:', err);
    }
  }
}
