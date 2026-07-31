import { readSession } from '../session';
import { callControlServer } from '../client';

export interface ValidateArgs {
  enableMrcm?: boolean;
  wait?: boolean;
  timeout?: string;
  project?: string;
  task?: string;
}

interface ValidateResponse {
  started?: boolean;
  finalStatus?: string;
  timedOut?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function runValidate(args: ValidateArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<ValidateResponse>(session, 'POST', '/tasks/validate', {
    enableMrcmValidation: args.enableMrcm,
    wait: !!args.wait,
    timeoutSeconds: args.timeout ? Number(args.timeout) : undefined,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    if (result.body.finalStatus !== undefined) {
      console.log(`Validation ${result.body.finalStatus}${result.body.timedOut ? ' (gave up waiting before this was confirmed terminal)' : ''}`);
    } else {
      console.log('Validation started');
    }
    if (result.body.timedOut) {
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Failed to start validation (HTTP ${result.statusCode}): ${result.body.error ?? JSON.stringify(result.body)}`);
  process.exitCode = 1;
}
