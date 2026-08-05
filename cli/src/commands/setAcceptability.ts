import { readSession } from '../session';
import { callControlServer } from '../client';
import { printValidationResults } from '../validationOutput';

export interface AcceptabilityEntryArg {
  descriptionId: string;
  lang?: string;
  us?: string;
  gb?: string;
}

export interface SetAcceptabilityArgs {
  id: string;
  descriptionId?: string;
  lang?: string;
  us?: string;
  gb?: string;
  entries?: string;
  project?: string;
  task?: string;
}

interface SetAcceptabilityResponse {
  conceptId?: string;
  error?: string;
  validationResults?: unknown;
  [key: string]: unknown;
}

/** Single-description mode (--description-id/--lang/--us/--gb) is a plain promote/demote and is
 * safe as its own PUT. Multi-description mode (--entries, a JSON array of the same fields keyed
 * by descriptionId) exists because swapping which description is "preferred" in a dialect — e.g.
 * SNOMED's edema/oedema-style US/GB spelling-variant pairs — needs both descriptions' changes in
 * one PUT: Snowstorm rejects either half of the swap done alone, since the intermediate state has
 * zero or two preferred synonyms in that dialect (its own "exactly one PT per language refset"
 * rule, independent of our own ?validate=true call). */
export async function runSetAcceptability(args: SetAcceptabilityArgs): Promise<void> {
  const session = readSession();

  if (args.entries) {
    let entries: AcceptabilityEntryArg[];
    try {
      entries = JSON.parse(args.entries);
    } catch (err) {
      console.error(`--entries is not valid JSON: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      console.error('--entries must be a non-empty JSON array of {descriptionId, lang?, us?, gb?} objects.');
      process.exitCode = 1;
      return;
    }

    const result = await callControlServer<SetAcceptabilityResponse>(session, 'POST', `/concepts/${encodeURIComponent(args.id)}/acceptability`, {
      entries,
      projectKey: args.project,
      taskKey: args.task,
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      console.log(`Set acceptability of ${entries.length} description(s) on concept ${args.id}`);
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
    return;
  }

  if (!args.descriptionId) {
    console.error('Either --description-id (with --lang/--us/--gb) or --entries is required.');
    process.exitCode = 1;
    return;
  }

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
