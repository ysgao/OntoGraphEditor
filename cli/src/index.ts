#!/usr/bin/env node
import { runCreateConcept } from './commands/createConcept';
import { runSearchConcepts } from './commands/searchConcepts';
import { runGetConcept } from './commands/getConcept';
import { runCurrentTask } from './commands/currentTask';
import { runValidateConcept } from './commands/validateConcept';
import { runReviewConcepts } from './commands/reviewConcepts';
import { runAddDescription } from './commands/addDescription';
import { runAddRelationship } from './commands/addRelationship';
import { runUpdateDescription } from './commands/updateDescription';
import { runSetCaseSignificance } from './commands/setCaseSignificance';
import { runSetAcceptability } from './commands/setAcceptability';
import { runInactivateConcept } from './commands/inactivateConcept';
import { runSetDefinitionStatus } from './commands/setDefinitionStatus';
import { runUpdateAxiom } from './commands/updateAxiom';
import { runUpdateGciAxiom } from './commands/updateGciAxiom';
import { runDeleteConcept } from './commands/deleteConcept';
import { runDeleteDescription } from './commands/deleteDescription';
import { runDeleteAxiom } from './commands/deleteAxiom';
import { runDeleteGciAxiom } from './commands/deleteGciAxiom';
import { runClassify } from './commands/classify';
import { runValidate } from './commands/validate';

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith('--') ? argv[++i] : '';
      flags[key] = value;
    }
  }
  return flags;
}

interface Command {
  name: string;
  usage: string;
  required?: string[];
  run: (flags: Record<string, string>) => Promise<void>;
}

const COMMANDS: Command[] = [
  {
    name: 'create-concept',
    usage:
      'create-concept --fsn "<term>" --parent <SCTID> [--tag <semantic tag>] [--pt "<preferred term>"] ' +
      '[--module <moduleId>] [--project <projectKey> --task <taskKey>]',
    required: ['fsn', 'parent'],
    run: (flags) =>
      runCreateConcept({
        fsn: flags.fsn,
        tag: flags.tag,
        pt: flags.pt,
        parent: flags.parent,
        module: flags.module,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'search-concepts',
    usage: 'search-concepts [--term <text>] [--ecl <expr>] [--active true|false] [--limit N] [--project <projectKey> --task <taskKey>]',
    run: (flags) =>
      runSearchConcepts({
        term: flags.term,
        ecl: flags.ecl,
        active: flags.active,
        limit: flags.limit,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'get-concept',
    usage: 'get-concept --id <SCTID> [--project <projectKey> --task <taskKey>]',
    required: ['id'],
    run: (flags) => runGetConcept({ id: flags.id, project: flags.project, task: flags.task }),
  },
  {
    name: 'current-task',
    usage:
      'current-task [--project <projectKey> --task <taskKey>] ' +
      '(prints the task currently open in OntoGraph Editor; with --project/--task, confirms whether they match — ' +
      'use this to verify the CLI and the UI are pointed at the same task)',
    run: (flags) => runCurrentTask({ project: flags.project, task: flags.task }),
  },
  {
    name: 'validate-concept',
    usage:
      'validate-concept --id <SCTID> [--project <projectKey> --task <taskKey>] ' +
      '(read-only check of the concept\'s current saved state — same convention rules the interactive editor runs on save, without saving anything)',
    required: ['id'],
    run: (flags) => runValidateConcept({ id: flags.id, project: flags.project, task: flags.task }),
  },
  {
    name: 'review-concepts',
    usage:
      'review-concepts [--project <projectKey> --task <taskKey>] ' +
      '(lists concepts with pending stated changes and concepts affected only by classification, derived from the task branch\'s traceability log, same as the Authoring Workbench\'s "Concepts for Review" tab)',
    run: (flags) => runReviewConcepts({ project: flags.project, task: flags.task }),
  },
  {
    name: 'add-description',
    usage:
      'add-description --id <SCTID> --term "<text>" --type FSN|SYNONYM [--tag <semanticTag>] ' +
      '[--module <id>] [--acceptability PREFERRED|ACCEPTABLE] [--project <projectKey> --task <taskKey>]',
    required: ['id', 'term', 'type'],
    run: (flags) =>
      runAddDescription({
        id: flags.id,
        term: flags.term,
        type: flags.type,
        tag: flags.tag,
        module: flags.module,
        acceptability: flags.acceptability,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'update-description',
    usage:
      'update-description --id <SCTID> --description-id <descriptionId> [--term "<text>"] [--case-significance <value>] ' +
      '[--project <projectKey> --task <taskKey>] (only if never versioned; reuses the existing descriptionId)',
    required: ['id', 'description-id'],
    run: (flags) =>
      runUpdateDescription({
        id: flags.id,
        descriptionId: flags['description-id'],
        term: flags.term,
        caseSignificance: flags['case-significance'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'set-case-significance',
    usage:
      'set-case-significance --id <SCTID> --description-id <descriptionId> ' +
      '--case-significance CASE_INSENSITIVE|INITIAL_CHARACTER_CASE_INSENSITIVE|ENTIRE_TERM_CASE_SENSITIVE ' +
      '[--project <projectKey> --task <taskKey>] (only if never versioned)',
    required: ['id', 'description-id', 'case-significance'],
    run: (flags) =>
      runSetCaseSignificance({
        id: flags.id,
        descriptionId: flags['description-id'],
        caseSignificance: flags['case-significance'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'set-acceptability',
    usage:
      'set-acceptability --id <SCTID> --description-id <descriptionId> [--lang <code, e.g. en>] ' +
      '[--us PREFERRED|ACCEPTABLE|NOT_ACCEPTABLE] [--gb PREFERRED|ACCEPTABLE|NOT_ACCEPTABLE] ' +
      '[--project <projectKey> --task <taskKey>] (at least one of --lang, --us, --gb required)',
    required: ['id', 'description-id'],
    run: (flags) =>
      runSetAcceptability({
        id: flags.id,
        descriptionId: flags['description-id'],
        lang: flags.lang,
        us: flags.us,
        gb: flags.gb,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'add-relationship',
    usage:
      'add-relationship --id <SCTID> --type <SCTID> --target <SCTID> [--group N] [--axiom-index N] ' +
      '[--project <projectKey> --task <taskKey>]',
    required: ['id', 'type', 'target'],
    run: (flags) =>
      runAddRelationship({
        id: flags.id,
        type: flags.type,
        target: flags.target,
        group: flags.group,
        axiomIndex: flags['axiom-index'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'inactivate-concept',
    usage:
      'inactivate-concept --id <SCTID> --indicator <value> [--association-refset <id> --association-target <SCTID>] ' +
      '[--project <projectKey> --task <taskKey>]',
    required: ['id', 'indicator'],
    run: (flags) =>
      runInactivateConcept({
        id: flags.id,
        indicator: flags.indicator,
        associationRefset: flags['association-refset'],
        associationTarget: flags['association-target'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'set-definition-status',
    usage: 'set-definition-status --id <SCTID> --status PRIMITIVE|FULLY_DEFINED [--axiom-index N] [--project <projectKey> --task <taskKey>]',
    required: ['id', 'status'],
    run: (flags) =>
      runSetDefinitionStatus({
        id: flags.id,
        status: flags.status,
        axiomIndex: flags['axiom-index'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'update-axiom',
    usage:
      'update-axiom --id <SCTID> --axiom-id <axiomId> --relationships \'[{"active":true,"groupId":0,"type":{"conceptId":"..."},"target":{"conceptId":"..."}}]\' ' +
      '[--project <projectKey> --task <taskKey>] (only if never versioned; replaces the axiom\'s relationships wholesale)',
    required: ['id', 'axiom-id', 'relationships'],
    run: (flags) =>
      runUpdateAxiom({
        id: flags.id,
        axiomId: flags['axiom-id'],
        relationships: flags.relationships,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'update-gci-axiom',
    usage:
      'update-gci-axiom --id <SCTID> --axiom-id <axiomId> --relationships \'[{"active":true,"groupId":0,"type":{"conceptId":"..."},"target":{"conceptId":"..."}}]\' ' +
      '[--project <projectKey> --task <taskKey>] (only if never versioned; replaces the axiom\'s relationships wholesale)',
    required: ['id', 'axiom-id', 'relationships'],
    run: (flags) =>
      runUpdateGciAxiom({
        id: flags.id,
        axiomId: flags['axiom-id'],
        relationships: flags.relationships,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'delete-concept',
    usage: 'delete-concept --id <SCTID> [--project <projectKey> --task <taskKey>] (only if never versioned)',
    required: ['id'],
    run: (flags) => runDeleteConcept({ id: flags.id, project: flags.project, task: flags.task }),
  },
  {
    name: 'delete-description',
    usage: 'delete-description --id <SCTID> --description-id <descriptionId> [--project <projectKey> --task <taskKey>] (only if never versioned)',
    required: ['id', 'description-id'],
    run: (flags) =>
      runDeleteDescription({
        id: flags.id,
        descriptionId: flags['description-id'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'delete-axiom',
    usage: 'delete-axiom --id <SCTID> --axiom-id <axiomId> [--project <projectKey> --task <taskKey>] (only if never versioned)',
    required: ['id', 'axiom-id'],
    run: (flags) =>
      runDeleteAxiom({
        id: flags.id,
        axiomId: flags['axiom-id'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'delete-gci-axiom',
    usage: 'delete-gci-axiom --id <SCTID> --axiom-id <axiomId> [--project <projectKey> --task <taskKey>] (only if never versioned)',
    required: ['id', 'axiom-id'],
    run: (flags) =>
      runDeleteGciAxiom({
        id: flags.id,
        axiomId: flags['axiom-id'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'classify',
    usage: 'classify [--wait] [--timeout <seconds>] [--project <projectKey> --task <taskKey>]',
    run: (flags) =>
      runClassify({
        wait: 'wait' in flags,
        timeout: flags.timeout,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'validate',
    usage: 'validate [--enable-mrcm] [--wait] [--timeout <seconds>] [--project <projectKey> --task <taskKey>]',
    run: (flags) =>
      runValidate({
        enableMrcm: 'enable-mrcm' in flags,
        wait: 'wait' in flags,
        timeout: flags.timeout,
        project: flags.project,
        task: flags.task,
      }),
  },
];

function usageText(): string {
  return [
    'Usage: authoring-cli <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.usage}`),
    '',
    'With no --project/--task, actions target whatever task is',
    'currently open in the OntoGraph Editor extension.',
  ].join('\n');
}

async function main(): Promise<void> {
  const [, , commandName, ...rest] = process.argv;
  const flags = parseFlags(rest);

  const command = COMMANDS.find((c) => c.name === commandName);
  if (!command) {
    console.error(commandName ? `Unknown command: ${commandName}\n\n${usageText()}` : usageText());
    process.exitCode = 1;
    return;
  }

  const missing = (command.required ?? []).filter((key) => !flags[key]);
  if (missing.length) {
    console.error(`Missing required flag(s): ${missing.map((k) => `--${k}`).join(', ')}\n\nUsage: ${command.usage}`);
    process.exitCode = 1;
    return;
  }

  await command.run(flags);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
