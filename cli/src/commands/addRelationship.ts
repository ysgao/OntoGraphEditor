import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface AddRelationshipArgs {
  id: string;
  type: string;
  target: string;
  group?: string;
  axiomIndex?: string;
  project?: string;
  task?: string;
}

interface AddRelationshipResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runAddRelationship(args: AddRelationshipArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<AddRelationshipResponse>(session, 'POST', `/concepts/${encodeURIComponent(args.id)}/relationships`, {
    typeId: args.type,
    targetId: args.target,
    groupId: args.group ? Number(args.group) : undefined,
    axiomIndex: args.axiomIndex ? Number(args.axiomIndex) : undefined,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Added relationship ${args.type} -> ${args.target} to concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to add relationship (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
