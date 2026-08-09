import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { command as _command, resolveCommand } from './command.js';
import {
  buildLeafUsage,
  generateHelp,
  generateLeafHelp,
  isHelpFlag,
  printCommandHelp,
  printHelp,
} from './help.js';
import { positionals as _positionals } from './positionals.js';

import type { ParseArgsConfig } from 'node:util';
import type { ArgsDef, CommandNode, PositionalsDef } from './types.js';

// ---------------------------------------------------------------------------
// Re-export the `from` factory (used by consumers to create args definitions).
// The actual implementation lives in ./from.ts and is imported here.
// ---------------------------------------------------------------------------

import { from as _from } from './from.js';

// ---------------------------------------------------------------------------
// zargv() — root factory that returns a runnable CLI instance.
// ---------------------------------------------------------------------------

export interface ZargvOptions {
  name: string;
  description?: string;
  commands: Record<string, CommandNode>;
}

interface RunnableCLI {
  run(argv: string[]): Promise<void>;
}

interface InternalArgsDef extends ArgsDef<z.ZodTypeAny> {
  _parseArgsConfig?: Record<string, unknown>;
}

interface InternalPositionalsDef extends PositionalsDef<unknown> {
  _usage: string;
  _parsePositionals(positionals: string[]): unknown;
}

function parseCommandArgs(
  remaining: string[],
  argsDef?: InternalArgsDef
): { values: Record<string, unknown>; positionals: string[] } {
  if (!argsDef?._parseArgsConfig) {
    return { positionals: remaining, values: {} };
  }

  try {
    const parseResult = parseArgs({
      allowPositionals: true,
      args: remaining,
      options: argsDef._parseArgsConfig as ParseArgsConfig['options'],
      strict: false, // allow unknown flags — we check them manually.
    });

    return { positionals: parseResult.positionals, values: parseResult.values };
  } catch (err) {
    console.error(`Error parsing arguments:\n${(err as Error).message}`);
    process.exit(1);
  }
}

function exitOnUnexpectedPositionals(positionals: string[]): void {
  if (positionals.length === 0) {
    return;
  }

  const suffix = positionals.length === 1 ? '' : 's';
  console.error(`Error: unexpected positional argument${suffix}: ${positionals.join(' ')}`);
  process.exit(1);
}

function validateCommandPositionals(
  rawPositionals: string[],
  positionalsDef?: InternalPositionalsDef,
  usageLine?: string,
  helpCommand?: string
): unknown {
  if (!positionalsDef) {
    exitOnUnexpectedPositionals(rawPositionals);
    return undefined;
  }

  try {
    return positionalsDef._parsePositionals(rawPositionals);
  } catch (err) {
    if (!(err instanceof z.ZodError)) {
      throw err;
    }

    printValidationErrors(err, usageLine, helpCommand);
    process.exit(1);
  }
}

function exitOnUnknownOptions(parsedValues: Record<string, unknown>, argsDef?: InternalArgsDef): void {
  if (!argsDef) {
    return;
  }

  const schema = argsDef.__zargv_schema__;
  const knownKeys = schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : new Set<string>();

  for (const key of Object.keys(parsedValues)) {
    if (knownKeys.has(key)) {
      continue;
    }

    console.error(`Error: unrecognized option "--${key}"`);
    process.exit(1); // unreachable in tests due to mocked exit.
  }
}

function printValidationErrors(error: z.ZodError, usageLine?: string, helpCommand?: string): void {
  console.error('Validation errors:');

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    const message =
      issue.code === 'invalid_enum_value' && Array.isArray(issue.options)
        ? `Invalid value for ${path}. Expected one of: [${issue.options.join(' | ')}]`
        : issue.message;

    console.error(`  ${path ? `${path}: ` : ''}${message}`);
  }

  if (usageLine) {
    console.error('');
    console.error(`Usage: ${usageLine}`);
  }

  if (helpCommand) {
    console.error(`Help:  ${helpCommand}`);
  }
}

function validateCommandArgs(
  parsedValues: Record<string, unknown>,
  argsDef?: InternalArgsDef,
  usageLine?: string,
  helpCommand?: string
): unknown {
  if (!argsDef) {
    return {};
  }

  try {
    return argsDef.__zargv_schema__.parse(parsedValues);
  } catch (err) {
    if (!(err instanceof z.ZodError)) {
      throw err;
    }

    printValidationErrors(err, usageLine, helpCommand);
    process.exit(1);
  }
}

/**
 * Create a runnable CLI application from a root configuration.
 */
function zargv(options: ZargvOptions): RunnableCLI {
  return {
    async run(argv: string[]): Promise<void> {
      // Strip "node" and script path — keep only user-provided tokens.
      const tokens = argv.slice(2);

      // Check for --help / -h at the root level (no subcommand given).
      if (tokens.length === 0 || isHelpFlag(tokens[0])) {
        printHelp(options.name, options.description ?? '', options.commands);
        return;
      }

      // Resolve command path.
      const resolved = resolveCommand(options.commands, tokens);

      if (!resolved) {
        console.error(`Error: unknown command "${tokens.join(' ')}"\n`);
        printHelp(options.name, options.description ?? '', options.commands);
        process.exit(1); // unreachable in tests due to mocked exit.
      }

      if (resolved.type === 'parent_help') {
        // --help encountered mid-path or at end of parent command — show subcommand list.
        console.log(generateHelp(resolved.commands, undefined));
        return;
      }

      const remaining = resolved.remainingArgs;
      const consumedTokenCount = tokens.length - remaining.length;
      const commandPath = tokens.slice(0, consumedTokenCount).join(' ');
      const scriptName = argv[1] ? basename(argv[1]) : options.name;
      const usagePrefix = commandPath ? `${scriptName} ${commandPath}` : scriptName;
      const usageLine = buildLeafUsage(resolved.command, { usagePrefix }) ?? usagePrefix;
      const helpCommand = `${usagePrefix} --help`;

      // Check for --help on the resolved leaf.
      if (remaining.length > 0 && isHelpFlag(remaining[0])) {
        const helpText = generateLeafHelp(resolved.command, { usagePrefix });
        if (!helpText) {
          printCommandHelp(tokens.slice(1), options.commands);
          return;
        }

        console.log(helpText);
        return;
      }

      // Parse, validate option names, then validate through Zod.
      const argsDef = (resolved.command as { argsDef?: InternalArgsDef }).argsDef;
      const positionalsDef = (resolved.command as { positionalsDef?: InternalPositionalsDef }).positionalsDef;
      const { values: parsedValues, positionals } = parseCommandArgs(remaining, argsDef);
      exitOnUnknownOptions(parsedValues, argsDef);
      const validatedPositionals = validateCommandPositionals(positionals, positionalsDef, usageLine, helpCommand);
      const validatedArgs = validateCommandArgs(parsedValues, argsDef, usageLine, helpCommand);

      // Invoke handler.
      await resolved.command.handler({ args: validatedArgs, positionals: validatedPositionals });
    },
  };
}

// ---------------------------------------------------------------------------
// Attach helpers to the zargv namespace for consumer convenience.
// ---------------------------------------------------------------------------

const _zargv = Object.assign(zargv, {
  /** Build a leaf or parent command node */
  command: _command,

  /** Convert a Zod schema into an args definition for `zargv.command()` */
  from: _from,

  /** Positional argument helpers */
  positionals: _positionals,
}) as typeof zargv & {
  command: typeof _command;
  from: typeof _from;
  positionals: typeof _positionals;
};

export type { FromOptions } from './from.js';
export type {
  ArgsDef,
  CommandNode,
  HandlerCtx,
  LeafCommand,
  PositionalsDef,
} from './types.js';
export { _zargv as zargv };
