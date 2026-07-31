import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface SetAcceptabilityArgs {
  id: string;
  descriptionId: string;
  lang?: string;
  us?: string;
  gb?: string;
  project?: string;
  task?: string;
}

interface SetAcceptabilityResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

export async function runSetAcceptability(args: SetAcceptabilityArgs): Promise<void> {
  const session = readSession();

  const result = await callControlServer<SetAcceptabilityResponse>(
    session,
    'POST',
    `/concepts/${encodeURIComponent(args.id)}/descriptions/${encodeURIComponent(args.descriptionId)}/acceptability`,
    { lang: args.lang, us: args.us, gb: args.gb, projectKey: args.project, taskKey: args.task }
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    const parts = [
      args.lang ? `lang=${args.lang}` : undefined,
      args.us ? `us=${args.us}` : undefined,
      args.gb ? `gb=${args.gb}` : undefined,
    ].filter(Boolean);
    console.log(`Set acceptability of description ${args.descriptionId} (${parts.join(', ')})`);
    printValidationResults(result.body.validationResults);
    return;
  }

  const detail = result.body.error
    ? result.body.error
    : result.body.validationResults
      ? JSON.stringify(result.body.validationResults, null, 2)
      : JSON.stringify(result.body);
  console.error(`Failed to set acceptability (HTTP ${result.statusCode}): ${detail}`);
  process.exitCode = 1;
}
