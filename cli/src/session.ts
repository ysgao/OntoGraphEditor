import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TaskContext {
  projectKey: string;
  taskKey: string;
  branchPath: string;
}

export interface SessionFile {
  host: string;
  port: number;
  token: string;
  signedIn: boolean;
  currentTask: TaskContext | null;
  updatedAt: string;
}

const SESSION_PATH = path.join(os.homedir(), '.ontograph-editor', 'session.json');

/**
 * Reads the discovery file the running OntoGraph Editor extension writes on activation and
 * whenever its IMS session or open task changes. There is no fixed host/port/token to
 * hardcode — this file is the only way the CLI learns the extension's current address.
 */
export function readSession(): SessionFile {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(
      `No OntoGraph Editor session found at ${SESSION_PATH}.\n` +
        'Open OntoGraph Editor in VS Code first (it writes this file on activation).'
    );
  }

  const raw = fs.readFileSync(SESSION_PATH, 'utf8');
  let parsed: SessionFile;
  try {
    parsed = JSON.parse(raw) as SessionFile;
  } catch (err) {
    throw new Error(`Session file at ${SESSION_PATH} is not valid JSON: ${(err as Error).message}`);
  }

  if (!parsed.signedIn) {
    throw new Error(
      'Not signed in to IMS in OntoGraph Editor — run "OntoGraph: Set IMS Session Cookie" or ' +
        '"OntoGraph: Import IMS Cookies from Chrome" in VS Code first.'
    );
  }

  return parsed;
}
