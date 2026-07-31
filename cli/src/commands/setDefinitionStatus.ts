import { readSession } from '../session';
import { callControlServer } from '../client';

export interface SetDefinitionStatusArgs {
  id: string;
  status: string;
  axiomIndex?: string;
  project?: string;
  task?: string;
}

interface SetDefinitionStatusResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runSetDefinitionStatus(args: SetDefinitionStatusArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<SetDefinitionStatusResponse>(session, 'POST', `/concepts/${encodeURIComponent(args.id)}/definition-status`, {
    status: args.status,
    axiomIndex: args.axiomIndex ? Number(args.axiomIndex) : undefined,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Set definition status of concept ${args.id} to ${args.status}`);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to set definition status (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
