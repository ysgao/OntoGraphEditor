import { readSession } from '../session';
import { callControlServer } from '../client';

export interface DeleteConceptArgs {
  id: string;
  project?: string;
  task?: string;
}

interface DeleteConceptResponse {
  error?: string;
  [key: string]: unknown;
}

export async function runDeleteConcept(args: DeleteConceptArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<DeleteConceptResponse>(session, 'DELETE', `/concepts/${encodeURIComponent(args.id)}`, {
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Deleted concept ${args.id}`);
    return;
  }

  const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
  console.error(`Failed to delete concept (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
