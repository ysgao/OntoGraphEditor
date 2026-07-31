import { readSession } from '../session';
import { callControlServer } from '../client';

export interface ClassifyArgs {
  wait?: boolean;
  timeout?: string;
  project?: string;
  task?: string;
}

interface ClassifySaveResult {
  accepted: boolean;
  status?: string;
  error?: string;
}

interface ClassifyResponse {
  jobId?: string;
  status?: string;
  finalStatus?: string;
  timedOut?: boolean;
  details?: unknown;
  save?: ClassifySaveResult;
  error?: string;
  [key: string]: unknown;
}

export async function runClassify(args: ClassifyArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<ClassifyResponse>(session, 'POST', '/tasks/classify', {
    wait: !!args.wait,
    timeoutSeconds: args.timeout ? Number(args.timeout) : undefined,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    if (result.body.finalStatus !== undefined) {
      console.log(`Classification ${result.body.finalStatus}${result.body.timedOut ? ' (gave up waiting before this was confirmed terminal)' : ''}`);
      if (result.body.details) {
        console.log(JSON.stringify(result.body.details, null, 2));
      }
      if (result.body.save) {
        if (result.body.save.accepted) {
          console.log('Classification results accepted and saved.');
        } else {
          console.error(`Classification results NOT saved${result.body.save.error ? `: ${result.body.save.error}` : ''}${result.body.save.status ? ` (status: ${result.body.save.status})` : ''}`);
          process.exitCode = 1;
        }
      }
    } else {
      console.log(`Classification started: job ${result.body.jobId} (${result.body.status})`);
    }
    if (result.body.timedOut) {
      process.exitCode = 1;
    }
    return;
  }

  const detail = result.body.details !== undefined ? ` — details: ${JSON.stringify(result.body.details)}` : '';
  console.error(`Failed to start classification (HTTP ${result.statusCode}): ${result.body.error ?? JSON.stringify(result.body)}${detail}`);
  process.exitCode = 1;
}
