import { readSession } from '../session';
import { callControlServer } from '../client';

export interface CurrentTaskArgs {
  project?: string;
  task?: string;
}

interface SessionResponse {
  signedIn?: boolean;
  currentTask?: { projectKey: string; taskKey: string; branchPath: string } | null;
  error?: string;
  [key: string]: unknown;
}

/** Reads the extension host's live in-memory session state (extension/src/shared/sessionState.ts,
 * updated on every TASK_CONTEXT_CHANGED message from the Authoring webview) rather than the CLI's
 * local ~/.ontograph/session.json snapshot — this is the authoritative answer to "what task does
 * the UI actually have open right now," useful for confirming the CLI's auto-detected task
 * context (used whenever --project/--task are omitted on other commands) matches what a human is
 * looking at in the Authoring Workbench. */
export async function runCurrentTask(args: CurrentTaskArgs): Promise<void> {
  const session = readSession();
  const result = await callControlServer<SessionResponse>(session, 'GET', '/session');

  if (result.statusCode < 200 || result.statusCode >= 300) {
    console.error(`Failed to read current task (HTTP ${result.statusCode}): ${result.body.error ?? JSON.stringify(result.body)}`);
    process.exitCode = 1;
    return;
  }

  const current = result.body.currentTask;
  if (!current) {
    console.log('No task is currently open in OntoGraph Editor.');
    process.exitCode = 1;
    return;
  }

  console.log('Current task open in OntoGraph Editor:');
  console.log(`  project: ${current.projectKey}`);
  console.log(`  task:    ${current.taskKey}`);
  console.log(`  branch:  ${current.branchPath}`);
  console.log(`  signed in: ${result.body.signedIn ? 'yes' : 'no'}`);

  if (args.project || args.task) {
    const projectMatches = !args.project || args.project === current.projectKey;
    const taskMatches = !args.task || args.task === current.taskKey;
    if (projectMatches && taskMatches) {
      console.log('\n✓ Matches the --project/--task you provided.');
    } else {
      console.log(`\n✗ Does NOT match the --project/--task you provided (project=${args.project ?? '(any)'}, task=${args.task ?? '(any)'}).`);
      process.exitCode = 1;
    }
  }
}
