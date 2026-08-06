#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { runCreateConcept } from './commands/createConcept';
import { runSearchConcepts } from './commands/searchConcepts';
import { runGetConcept } from './commands/getConcept';
import { runCurrentTask } from './commands/currentTask';
import { runValidateConcept } from './commands/validateConcept';
import { runReviewConcepts } from './commands/reviewConcepts';
import { runAddDescription } from './commands/addDescription';
import { runAddRelationship } from './commands/addRelationship';
import { runRemoveRelationship } from './commands/removeRelationship';
import { runRemoveRoleGroup } from './commands/removeRoleGroup';
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
import { runClassificationStatus } from './commands/classificationStatus';
import { runValidateTask } from './commands/validateTask';
import { runValidationStatus } from './commands/validationStatus';
import { runWatchNotification } from './commands/watchNotification';

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
  /** Alternate names that dispatch to the same command — e.g. a more familiar verb ("delete")
   * for a command named with a different one ("remove"), so neither a human nor an AI agent
   * guessing at the command name needs to already know which verb this CLI picked. */
  aliases?: string[];
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
      '[--project <projectKey> --task <taskKey>] (at least one of --lang, --us, --gb required)\n' +
      '  set-acceptability --id <SCTID> --entries \'[{"descriptionId":"...","gb":"PREFERRED"},{"descriptionId":"...","gb":"ACCEPTABLE"}]\' ' +
      '[--project <projectKey> --task <taskKey>] (applies all entries in one save — use this to swap which description is ' +
      "preferred in a dialect, e.g. a US/GB spelling variant pair; doing it as two separate --description-id calls fails " +
      "either order, since Snowstorm requires exactly one preferred synonym per dialect at all times)",
    required: ['id'],
    run: (flags) =>
      runSetAcceptability({
        id: flags.id,
        descriptionId: flags['description-id'],
        lang: flags.lang,
        us: flags.us,
        gb: flags.gb,
        entries: flags.entries,
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
    name: 'remove-relationship',
    aliases: ['delete-relationship'],
    usage:
      'remove-relationship --id <SCTID> --axiom-id <axiomId> (--relationship-id <relationshipId> | --relationship-index N) ' +
      '[--project <projectKey> --task <taskKey>] (only if the targeted relationship was never versioned)',
    required: ['id', 'axiom-id'],
    run: (flags) =>
      runRemoveRelationship({
        id: flags.id,
        axiomId: flags['axiom-id'],
        relationshipId: flags['relationship-id'],
        relationshipIndex: flags['relationship-index'],
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'remove-role-group',
    aliases: ['delete-role-group', 'delete-rolegroup'],
    usage:
      'remove-role-group --id <SCTID> --axiom-id <axiomId> --attributes \'[{"typeId":"...","targetId":"..."}]\' [--group-id N] ' +
      '[--project <projectKey> --task <taskKey>] (--attributes only needs to identify the group, not enumerate it — ' +
      'one pair is enough if it is unique to one role group in the axiom; if it matches more than one group, the call ' +
      'fails listing every candidate groupId so you can add another pair to disambiguate, or pass --group-id directly; ' +
      'works on published axioms — only blocked if a matched relationship was itself individually versioned)',
    required: ['id', 'axiom-id', 'attributes'],
    run: (flags) =>
      runRemoveRoleGroup({
        id: flags.id,
        axiomId: flags['axiom-id'],
        attributes: flags.attributes,
        groupId: flags['group-id'],
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
    usage: 'classify [--wait] [--timeout <seconds>, default 180] [--project <projectKey> --task <taskKey>] ' +
      '(checks the branch\'s current classification state first: attaches to and waits on an ' +
      'already-running job, accepts an already-completed-but-unsaved one, and only starts a new ' +
      'run when nothing is pending — never blindly starts a second job on top of one already there. ' +
      'With --wait, polls on a tightening schedule matching the webview\'s: skips the first 90s ' +
      '(classification normally takes ~2 minutes), then every 10s for 30s, then every 5s — same ' +
      'schedule the extension\'s webview uses, so both feel consistent watching the same job. Pass ' +
      'a larger --timeout for a known-large branch where ELK genuinely takes longer.)',
    run: (flags) =>
      runClassify({
        wait: 'wait' in flags,
        timeout: flags.timeout,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'classification-status',
    usage: 'classification-status [--project <projectKey> --task <taskKey>] ' +
      '(read-only — reports the branch\'s current classification job and status without starting ' +
      'or saving anything; safe to call anytime, including while classify might be running)',
    run: (flags) =>
      runClassificationStatus({
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'validate-task',
    usage: 'validate-task [--enable-mrcm] [--wait] [--timeout <seconds>, default 900] [--project <projectKey> --task <taskKey>] ' +
      '(validates the whole task branch — distinct from validate-concept, which read-only checks a single concept. ' +
      'Checks current status first: if a validation is already RUNNING/QUEUED/SCHEDULED, attaches to and waits ' +
      'on it instead of starting a second one on the same task (regardless of --wait). Otherwise starts fresh. ' +
      'RVF validation routinely takes ~10 minutes or more, so any wait polls on a backed-off schedule, not a flat ' +
      'interval: skips the first 5 minutes, then checks once a minute for 5 minutes, then every 30s for 5 more ' +
      '(15 min total default). Use validation-status instead to check without blocking.)',
    run: (flags) =>
      runValidateTask({
        enableMrcm: 'enable-mrcm' in flags,
        wait: 'wait' in flags,
        timeout: flags.timeout,
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'validation-status',
    usage: 'validation-status [--project <projectKey> --task <taskKey>] ' +
      '(read-only — reports the task\'s current validation status without starting or waiting on ' +
      'anything; use this to check on a long-running validate-task instead of blocking with --wait)',
    run: (flags) =>
      runValidationStatus({
        project: flags.project,
        task: flags.task,
      }),
  },
  {
    name: 'watch-notification',
    usage: 'watch-notification [--entity-type <type>] [--timeout <seconds>, default 60] [--project <projectKey> --task <taskKey>] ' +
      '(read-only — blocks until the next real-time SCA notification for this task arrives, or the ' +
      'timeout elapses, then prints it; a "tell me what happens next" companion to classify/validate-task, ' +
      'which only wake early on a notification for their own specific job. --entity-type narrows to one of ' +
      'Classification, Validation, Rebase, Promotion, BranchState, BranchHead, Feedback, AuthorChange — omit ' +
      'to match any of them. Exits non-zero on a timeout, same convention as --wait timing out on classify/validate-task.)',
    run: (flags) =>
      runWatchNotification({
        project: flags.project,
        task: flags.task,
        entityType: flags['entity-type'],
        timeout: flags.timeout,
      }),
  },
];

/**
 * `dist/index.js`'s own directory is one level under the package root in every deployment shape
 * this ships in — the repo (cli/dist/index.js next to cli/skills/) and the extension-bundled copy
 * (dist/cli/dist/index.js next to dist/cli/skills/, see extension/esbuild.mjs) both mirror that
 * layout, so the same relative lookup resolves in both. Absent (not an error) if the skill wasn't
 * bundled into this particular build.
 */
function resolveSkillPath(): string | undefined {
  const candidate = path.join(__dirname, '..', 'skills', 'authoring-cli', 'SKILL.md');
  return fs.existsSync(candidate) ? candidate : undefined;
}

/** Inserts "(alias: ...)" right after the command's own name token in its usage string, so the
 * alias reads as part of the command identity rather than a trailing, easily-missed note. */
function usageLine(c: Command): string {
  if (!c.aliases?.length) {
    return c.usage;
  }
  const note = `(alias: ${c.aliases.join(', ')})`;
  return c.usage.startsWith(c.name) ? `${c.name} ${note}${c.usage.slice(c.name.length)}` : `${c.usage} ${note}`;
}

function usageText(): string {
  const skillPath = resolveSkillPath();
  return [
    'Usage: authoring-cli <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${usageLine(c)}`),
    '',
    'With no --project/--task, actions target whatever task is',
    'currently open in the OntoGraph Editor extension.',
    ...(skillPath
      ? ['', `Full usage guide for AI agents (dialect/acceptability editing, worked examples): ${skillPath}`]
      : []),
  ].join('\n');
}

async function main(): Promise<void> {
  const [, , commandName, ...rest] = process.argv;
  const flags = parseFlags(rest);

  if (!commandName) {
    // Bare invocation (no args at all) is the documented way to discover the command list — see
    // CLAUDE.md and the bundled skill — not a user error. Exiting 0 here matters for any harness
    // (e.g. an AI agent's shell tool) that treats a non-zero exit as "the command failed": running
    // `authoring-cli` to look up usage should never be reported as a failure.
    console.log(usageText());
    return;
  }

  const command = COMMANDS.find((c) => c.name === commandName || c.aliases?.includes(commandName));
  if (!command) {
    console.error(`Unknown command: ${commandName}\n\n${usageText()}`);
    process.exitCode = 1;
    return;
  }

  const missing = (command.required ?? []).filter((key) => !flags[key]);
  if (missing.length) {
    console.error(`Missing required flag(s): ${missing.map((k) => `--${k}`).join(', ')}\n\nUsage: ${usageLine(command)}`);
    process.exitCode = 1;
    return;
  }

  await command.run(flags);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
