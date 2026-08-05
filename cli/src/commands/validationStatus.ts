import { readSession } from '../session';
import { callControlServer } from '../client';

export interface ValidationStatusArgs {
  project?: string;
  task?: string;
}

interface ValidationStatusResponse {
  hasValidation?: boolean;
  status?: string;
  running?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function runValidationStatus(args: ValidationStatusArgs): Promise<void> {
  const session = readSession();

  const query = new URLSearchParams();
  if (args.project) {
    query.set('projectKey', args.project);
  }
  if (args.task) {
    query.set('taskKey', args.task);
  }
  const qs = query.toString();
  const path = `/tasks/validation-status${qs ? `?${qs}` : ''}`;

  const result = await callControlServer<ValidationStatusResponse>(session, 'GET', path);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
    console.error(`Failed to check validation status (HTTP ${result.statusCode}): ${detail}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.body, null, 2));
}
