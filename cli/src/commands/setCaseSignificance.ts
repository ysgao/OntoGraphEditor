import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface SetCaseSignificanceArgs {
  id: string;
  descriptionId: string;
  caseSignificance: string;
  project?: string;
  task?: string;
}

interface SetCaseSignificanceResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runSetCaseSignificance(args: SetCaseSignificanceArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<SetCaseSignificanceResponse>(
    session,
    'POST',
    `/concepts/${encodeURIComponent(args.id)}/descriptions/${encodeURIComponent(args.descriptionId)}/case-significance`,
    { caseSignificance: args.caseSignificance, projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Set case significance of description ${args.descriptionId} to ${args.caseSignificance}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to set case significance (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
