import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface DeleteGciAxiomArgs {
  id: string;
  axiomId: string;
  project?: string;
  task?: string;
}

interface DeleteGciAxiomResponse {
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runDeleteGciAxiom(args: DeleteGciAxiomArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<DeleteGciAxiomResponse>(
    session,
    'DELETE',
    `/concepts/${encodeURIComponent(args.id)}/gci-axioms/${encodeURIComponent(args.axiomId)}`,
    { projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(`Deleted GCI axiom ${args.axiomId} from concept ${args.id}`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
  console.error(`Failed to delete GCI axiom (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
