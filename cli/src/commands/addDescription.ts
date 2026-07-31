import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface AddDescriptionArgs {
  id: string;
  term: string;
  type: string;
  tag?: string;
  module?: string;
  acceptability?: string;
  project?: string;
  task?: string;
}

interface AddDescriptionResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runAddDescription(args: AddDescriptionArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<AddDescriptionResponse>(session, 'POST', `/concepts/${encodeURIComponent(args.id)}/descriptions`, {
    term: args.term,
    type: args.type,
    semanticTag: args.tag,
    moduleId: args.module,
    acceptability: args.acceptability,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Added ${args.type} description to concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to add description (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
