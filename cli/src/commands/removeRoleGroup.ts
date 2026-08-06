import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface RemoveRoleGroupArgs {
  id: string;
  axiomId: string;
  attributes: string;
  groupId?: string;
  project?: string;
  task?: string;
}

interface RemoveRoleGroupResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runRemoveRoleGroup(args: RemoveRoleGroupArgs): Promise<void> {
  let attributes: unknown;
  try {
    attributes = JSON.parse(args.attributes);
  } catch (err) {
    console.error(`--attributes must be valid JSON (an array of {"typeId":"...","targetId":"..."} objects): ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const session = readSession();

  const result = await callControlServer<RemoveRoleGroupResponse>(
    session,
    'DELETE',
    `/concepts/${encodeURIComponent(args.id)}/axioms/${encodeURIComponent(args.axiomId)}/role-groups`,
    {
      attributes,
      groupId: args.groupId != null && args.groupId !== '' ? Number(args.groupId) : undefined,
      projectKey: args.project,
      taskKey: args.task,
    }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Removed role group from axiom ${args.axiomId} on concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to remove role group (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
