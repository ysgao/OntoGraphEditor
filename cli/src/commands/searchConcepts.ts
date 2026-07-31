import { readSession } from '../session';
import { callControlServer } from '../client';

export interface SearchConceptsArgs {
  term?: string;
  ecl?: string;
  active?: string;
  limit?: string;
  project?: string;
  task?: string;
}

interface SearchConceptsResponse {
  total?: number;
  items?: Array<{ conceptId: string; fsn?: string; pt?: string; active?: boolean; moduleId?: string }>;
  error?: string;
  [key: string]: unknown;
}

export async function runSearchConcepts(args: SearchConceptsArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<SearchConceptsResponse>(session, 'POST', '/concepts/search', {
    term: args.term,
    ecl: args.ecl,
    active: args.active === undefined ? undefined : args.active === 'true',
    limit: args.limit ? Number(args.limit) : undefined,
    projectKey: args.project,
    taskKey: args.task,
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    console.log(JSON.stringify(result.body, null, 2));
    return;
  }

  console.error(`Search failed (HTTP ${result.statusCode}): ${result.body.error ?? JSON.stringify(result.body)}`);
  process.exitCode = 1;
}
