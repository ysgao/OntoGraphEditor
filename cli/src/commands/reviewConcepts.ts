import { readSession } from '../session';
import { callControlServer } from '../client';

export interface ReviewConceptsArgs {
  project?: string;
  task?: string;
}

interface ReviewConceptsResponse {
  branchPath?: string;
  concepts?: unknown[];
  conceptsClassified?: unknown[];
  error?: string;
  [key: string]: unknown;
}

export async function runReviewConcepts(args: ReviewConceptsArgs): Promise<void> {
  const session = readSession();

  const query = new URLSearchParams();
  if (args.project) {
    query.set('projectKey', args.project);
  }
  if (args.task) {
    query.set('taskKey', args.task);
  }
  const qs = query.toString();
  const path = `/tasks/review-concepts${qs ? `?${qs}` : ''}`;

  const result = await callControlServer<ReviewConceptsResponse>(session, 'GET', path);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const detail = result.body.error ? result.body.error : JSON.stringify(result.body);
    console.error(`Failed to list concepts for review (HTTP ${result.statusCode}): ${detail}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.body, null, 2));
}
