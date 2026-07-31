#!/usr/bin/env node
import { runCreateConcept } from './commands/createConcept';
import { runSearchConcepts } from './commands/searchConcepts';
import { runGetConcept } from './commands/getConcept';
import { runAddDescription } from './commands/addDescription';
import { runAddRelationship } from './commands/addRelationship';
import { runInactivateConcept } from './commands/inactivateConcept';
import { runSetDefinitionStatus } from './commands/setDefinitionStatus';
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
    name: 'add-description',
    usage:
      'add-description --id <SCTID> --term "<text>" --type FSN|SYNONYM [--tag <semanticTag>] ' +
      '[--module <id>] [--project <projectKey> --task <taskKey>]',
    required: ['id', 'term', 'type'],
    run: (flags) =>
      runAddDescription({
        id: flags.id,
        term: flags.term,
        type: flags.type,
        tag: flags.tag,
        module: flags.module,
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
