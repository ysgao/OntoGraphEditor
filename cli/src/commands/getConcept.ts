import { readSession } from '../session';
import { callControlServer } from '../client';

export interface GetConceptArgs {
  id: string;
  project?: string;
  task?: string;
}

export async function runGetConcept(args: GetConceptArgs): Promise<void> {
  const session = readSession();

  const query = new URLSearchParams();
  if (args.project) {
    query.set('projectKey', args.project);
  }
  if (args.task) {
    query.set('taskKey', args.task);
  }
  const qs = query.toString();
  const path = `/concepts/${encodeURIComponent(args.id)}${qs ? `?${qs}` : ''}`;

  const result = await callControlServer<Record<string, unknown>>(session, 'GET', path);

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(JSON.stringify(result.body, null, 2));
    return;
  }

  console.error(`Failed to get concept (HTTP ${result.statusCode}): ${JSON.stringify(result.body)}`);
  process.exitCode = 1;
}
