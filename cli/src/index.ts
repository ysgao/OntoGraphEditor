#!/usr/bin/env node
import { runCreateConcept } from './commands/createConcept';

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

const USAGE = [
  'Usage: authoring-cli <command> [options]',
  '',
  'Commands:',
  '  create-concept --fsn "<term>" --parent <SCTID> [--tag <semantic tag>]',
  '                 [--pt "<preferred term>"] [--module <moduleId>]',
  '                 [--project <projectKey> --task <taskKey>]',
  '',
  'With no --project/--task, the concept is created in whatever task is',
  'currently open in the OntoGraph Editor extension.',
].join('\n');

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  switch (command) {
    case 'create-concept': {
      if (!flags.fsn || !flags.parent) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
      }
      await runCreateConcept({
        fsn: flags.fsn,
        tag: flags.tag,
        pt: flags.pt,
        parent: flags.parent,
        module: flags.module,
        project: flags.project,
        task: flags.task,
      });
      return;
    }
    default:
      console.error(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
