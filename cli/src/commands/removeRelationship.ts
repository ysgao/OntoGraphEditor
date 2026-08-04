import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface RemoveRelationshipArgs {
  id: string;
  axiomId: string;
  relationshipId?: string;
  relationshipIndex?: string;
  project?: string;
  task?: string;
}

interface RemoveRelationshipResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runRemoveRelationship(args: RemoveRelationshipArgs): Promise<void> {
  if (!args.relationshipId && !args.relationshipIndex) {
    console.error('One of --relationship-id or --relationship-index is required.');
    process.exitCode = 1;
    return;
  }

  const session = readSession();

  const result = await callControlServer<RemoveRelationshipResponse>(
    session,
    'DELETE',
    `/concepts/${encodeURIComponent(args.id)}/axioms/${encodeURIComponent(args.axiomId)}/relationships`,
    {
      relationshipId: args.relationshipId,
      relationshipIndex: args.relationshipIndex ? Number(args.relationshipIndex) : undefined,
      projectKey: args.project,
      taskKey: args.task,
    }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Removed relationship ${args.relationshipId ?? `at index ${args.relationshipIndex}`} from axiom ${args.axiomId} on concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to remove relationship (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
