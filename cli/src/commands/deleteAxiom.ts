import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface DeleteAxiomArgs {
  id: string;
  axiomId: string;
  project?: string;
  task?: string;
}

interface DeleteAxiomResponse {
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runDeleteAxiom(args: DeleteAxiomArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<DeleteAxiomResponse>(
    session,
    'DELETE',
    `/concepts/${encodeURIComponent(args.id)}/axioms/${encodeURIComponent(args.axiomId)}`,
    { projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Deleted axiom ${args.axiomId} from concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
  console.error(`Failed to delete axiom (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
