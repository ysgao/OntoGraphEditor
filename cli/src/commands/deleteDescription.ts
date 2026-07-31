import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface DeleteDescriptionArgs {
  id: string;
  descriptionId: string;
  project?: string;
  task?: string;
}

interface DeleteDescriptionResponse {
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runDeleteDescription(args: DeleteDescriptionArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<DeleteDescriptionResponse>(
    session,
    'DELETE',
    `/concepts/${encodeURIComponent(args.id)}/descriptions/${encodeURIComponent(args.descriptionId)}`,
    { projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Deleted description ${args.descriptionId} from concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
  console.error(`Failed to delete description (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
