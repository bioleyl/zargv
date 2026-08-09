import type {
  ArgsDef,
  CommandNode,
  DefsHandlerCtx,
  InferArgs,
  InferPositionals,
  LeafCommand,
  ParentCommand,
  PositionalsDef,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — attach metadata to command nodes.
// ---------------------------------------------------------------------------

interface CommandMeta {
  __name__?: string; // key under which this command was registered in its parent (set at registration time)
}

type NamedLeaf = LeafCommand<never, never> & CommandMeta;
type NamedParent = ParentCommand & CommandMeta;
type TypedNamedLeaf<A, P> = LeafCommand<A, P> & CommandMeta;

// ---------------------------------------------------------------------------
// Public API — zargv.command(options)
// ---------------------------------------------------------------------------

export interface CommandOptions<A extends ArgsDef | undefined, P extends PositionalsDef | undefined> {
  /** Short description shown in help */
  description?: string;

  /** Parsed from a Zod schema via `zargv.from()` (optional) */
  args?: A;

  /** Nested sub-commands keyed by their CLI name */
  commands?: Record<string, CommandNode>;

  /** Positional operand parser/validator */
  positionals?: P;

  /** Handler invoked when this command is matched. Receives validated args. */
  handler?(ctx: DefsHandlerCtx<A, P>): Promise<void> | void;
}

interface LeafCommandOptions<A extends ArgsDef | undefined, P extends PositionalsDef | undefined>
  extends CommandOptions<A, P> {
  commands?: undefined;
  handler(ctx: DefsHandlerCtx<A, P>): Promise<void> | void;
}

interface ParentCommandOptions extends CommandOptions<undefined, undefined> {
  commands: Record<string, CommandNode>;
  handler?: undefined;
}

/**
 * Build a command node (leaf or parent) that can be composed into the CLI tree.
 *
 * @example
 *   export default zargv.command({
 *     description: "Create a user",
 *     args: zargv.from(createUserSchema, { aliases: { name: "n" } }),
 *     handler({ args }) {},
 *   });
 */
export function command<
  A extends ArgsDef | undefined = undefined,
  P extends PositionalsDef | undefined = undefined,
>(options: LeafCommandOptions<A, P>): LeafCommand<InferArgs<A>, InferPositionals<P>>;
export function command(options: ParentCommandOptions): ParentCommand;
export function command<
  A extends ArgsDef | undefined = undefined,
  P extends PositionalsDef | undefined = undefined,
>(options: CommandOptions<A, P>): CommandNode {
  const commands = options.commands;
  const hasCommands = Boolean(commands && Object.keys(commands).length > 0);

  if (hasCommands && options.handler) {
    throw new TypeError('Parent command cannot define a handler');
  }

  if (!hasCommands && !options.handler) {
    throw new TypeError('Leaf command requires a handler');
  }

  if (hasCommands && commands) {
    // Parent command — attach names to children for routing.
    const namedChildren: Record<string, NamedParent | NamedLeaf> = {};
    for (const [name, child] of Object.entries(commands)) {
      namedChildren[name] = Object.assign(child, { __name__: name });
    }

    return {
      __brand__: 'parent',
      commands: namedChildren,
      description: options.description,
    };
  }

  // Leaf command — store argsDef reference for routing / help.
  const handler = options.handler;
  if (!handler) {
    throw new TypeError('Leaf command requires a handler');
  }

  const leaf: TypedNamedLeaf<InferArgs<A>, InferPositionals<P>> = {
    __brand__: 'leaf',
    description: options.description,
    handler,
  };

  if (options.args) {
    leaf.argsDef = options.args;
  }

  if (options.positionals) {
    leaf.positionalsDef = options.positionals;
  }

  return leaf as LeafCommand<unknown, unknown>;
}

// ---------------------------------------------------------------------------
// Type-level helpers — extract command info for the runner.
// ---------------------------------------------------------------------------

/** Get all leaf commands recursively, flattened with their full path */
export interface FlattenedCommand {
  /** Full CLI path, e.g. "users create" */
  path: string;
  name: string; // last segment only
  command: LeafCommand<unknown, unknown>;
}

export function flattenCommands(commands: Record<string, CommandNode>, prefix = ''): FlattenedCommand[] {
  const results: FlattenedCommand[] = [];

  for (const [name, node] of Object.entries(commands)) {
    const path = prefix ? `${prefix} ${name}` : name;

    if (node.__brand__ === 'leaf') {
      // Leaf — it's a terminal command.
      results.push({ command: node as LeafCommand<unknown, unknown>, name, path });
    } else {
      // Parent — recurse into children.
      const childResults = flattenCommands(node.commands, path);
      results.push(...childResults);

      // Also include the parent itself if it has a handler (rare but possible).
      // We treat parents with commands as non-leaf for now; they can't be run directly.
    }
  }

  return results;
}

/** Result types for command resolution */
type ResolveResult =
  | { type: 'leaf'; command: LeafCommand<unknown, unknown>; remainingArgs: string[] }
  | { type: 'parent_help'; commands: Record<string, CommandNode>; description?: string };

/** Resolve which command node to execute given an argv token list */
export function resolveCommand(rootCommands: Record<string, CommandNode>, tokens: string[]): ResolveResult | null {
  let current = rootCommands;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Check for --help / -h mid-path — show help for the parent level.
    if (token === '--help' || token === '-h') {
      return { commands: current, type: 'parent_help' };
    }

    if (!Object.hasOwn(current, token)) {
      return null; // path not found.
    }

    const node = current[token];
    if (!node) {
      return null;
    }

    if (node.__brand__ === 'leaf') {
      // Reached a leaf — remaining argv are the command's arguments.
      return { command: node as LeafCommand<unknown, unknown>, remainingArgs: tokens.slice(i + 1), type: 'leaf' };
    }

    // Parent — descend into its children.
    current = node.commands;
    i++;
  }

  // We ran out of tokens but are at a parent (no leaf reached).
  return { commands: current, type: 'parent_help' };
}
