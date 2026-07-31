import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface ValidateConceptArgs {
  id: string;
  project?: string;
  task?: string;
}

interface ValidateConceptResponse {
  conceptId?: string;
  validationResults?: unknown[];
  hasErrors?: boolean;
  hasWarnings?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function runValidateConcept(args: ValidateConceptArgs): Promise<void> {
  const session = readSession();

  const query = new URLSearchParams();
  if (args.project) {
    query.set('projectKey', args.project);
  }
  if (args.task) {
    query.set('taskKey', args.task);
  }
  const qs = query.toString();
  const path = `/concepts/${encodeURIComponent(args.id)}/validation${qs ? `?${qs}` : ''}`;

  const result = await callControlServer<ValidateConceptResponse>(session, 'GET', path);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
    console.error(`Failed to validate concept (HTTP ${result.statusCode}): ${detail}`);
    process.exitCode = 1;
    return;
  }

  const items = result.body.validationResults;
  if (!Array.isArray(items) || items.length === 0) {
    console.log(`No validation issues for concept ${args.id}.`);
    return;
  }

  printValidationResults(items);
  if (result.body.hasErrors) {
    process.exitCode = 1;
  }
}
