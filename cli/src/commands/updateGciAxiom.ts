import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface UpdateGciAxiomArgs {
  id: string;
  axiomId: string;
  relationships: string;
  project?: string;
  task?: string;
}

interface UpdateGciAxiomResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runUpdateGciAxiom(args: UpdateGciAxiomArgs): Promise<void> {
  let relationships: unknown;
  try {
    relationships = JSON.parse(args.relationships);
  } catch (err) {
    console.error(`--relationships must be valid JSON (an array of relationship objects): ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const session = readSession();

  const result = await callControlServer<UpdateGciAxiomResponse>(
    session,
    'POST',
    `/concepts/${encodeURIComponent(args.id)}/gci-axioms/${encodeURIComponent(args.axiomId)}`,
    { relationships, projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Updated GCI axiom ${args.axiomId} on concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to update GCI axiom (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
