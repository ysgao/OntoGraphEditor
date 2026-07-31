import { readSession } from '../session';
import { callControlServer } from '../client';

export interface InactivateConceptArgs {
  id: string;
  indicator: string;
  associationRefset?: string;
  associationTarget?: string;
  project?: string;
  task?: string;
}

interface InactivateConceptResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runInactivateConcept(args: InactivateConceptArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<InactivateConceptResponse>(session, 'POST', `/concepts/${encodeURIComponent(args.id)}/inactivate`, {
    indicator: args.indicator,
    associationRefsetId: args.associationRefset,
    associationTargetId: args.associationTarget,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Inactivated concept ${args.id}`);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to inactivate concept (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
