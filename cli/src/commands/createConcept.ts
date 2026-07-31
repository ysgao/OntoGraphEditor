import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface CreateConceptArgs {
  fsn: string;
  tag?: string;
  pt?: string;
  parent: string;
  module?: string;
  project?: string;
  task?: string;
}

interface CreateConceptResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runCreateConcept(args: CreateConceptArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<CreateConceptResponse>(session, 'POST', '/concepts', {
    fsn: args.fsn,
    semanticTag: args.tag,
    preferredTerm: args.pt,
    parentConceptId: args.parent,
    moduleId: args.module,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300 && result.body.conceptId) {
    console.log(`Created concept ${result.body.conceptId}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to create concept (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
