import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskContext } from './sessionState';

/**
 * Discovery file for the headless CLI (cli/): since ControlServer's port is OS-assigned
 * and its bearer token is generated fresh per VS Code session, there is no fixed address
 * to hardcode. The extension host writes the current address/token/task context here on
 * every relevant change; the CLI reads it fresh on each invocation.
 */
const SESSION_DIR = path.join(os.homedir(), '.ontograph-editor');
const SESSION_PATH = path.join(SESSION_DIR, 'session.json');

export interface SessionFileContents {
  host: string;
  port: number;
  token: string;
  signedIn: boolean;
  currentTask: TaskContext | null;
  updatedAt: string;
}

export function writeSessionFile(contents: Omit<SessionFileContents, 'updatedAt'>): void {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    const full: SessionFileContents = { ...contents, updatedAt: new Date().toISOString() };
    fs.writeFileSync(SESSION_PATH, JSON.stringify(full, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[OntoGraph] failed to write session file:', (err as Error).message);
  }
}

export function removeSessionFile(): void {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      fs.unlinkSync(SESSION_PATH);
    }
  } catch (err) {
    console.warn('[OntoGraph] failed to remove session file:', (err as Error).message);
  }
}

export function getSessionFilePath(): string {
  return SESSION_PATH;
}
