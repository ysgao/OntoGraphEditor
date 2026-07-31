import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface UpdateDescriptionArgs {
  id: string;
  descriptionId: string;
  term?: string;
  caseSignificance?: string;
  project?: string;
  task?: string;
}

interface UpdateDescriptionResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runUpdateDescription(args: UpdateDescriptionArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<UpdateDescriptionResponse>(
    session,
    'POST',
    `/concepts/${encodeURIComponent(args.id)}/descriptions/${encodeURIComponent(args.descriptionId)}`,
    {
      term: args.term,
      caseSignificance: args.caseSignificance,
      projectKey: args.project,
      taskKey: args.task,
    }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Updated description ${args.descriptionId} on concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to update description (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
