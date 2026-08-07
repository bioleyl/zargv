import { z } from "zod";
import type {
  ArgsDef,
  CommandNode,
  DefsHandlerCtx,
  HandlerCtx,
  InferArgs,
  InferPositionals,
  LeafCommand,
  ParentCommand,
  PositionalsDef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers — attach metadata to command nodes.
// ---------------------------------------------------------------------------

interface CommandMeta {
  __name__?: string; // key under which this command was registered in its parent (set at registration time)
}

type NamedLeaf = LeafCommand<any> & CommandMeta;
type NamedParent = ParentCommand & CommandMeta;

// ---------------------------------------------------------------------------
// Public API — zargv.command(options)
// ---------------------------------------------------------------------------

export interface CommandOptions<
  A extends ArgsDef<any> | undefined,
  P extends PositionalsDef<any> | undefined,
> {
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

interface LeafCommandOptions<
  A extends ArgsDef<any> | undefined,
  P extends PositionalsDef<any> | undefined,
> extends CommandOptions<A, P> {
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
  A extends ArgsDef<any> | undefined = undefined,
  P extends PositionalsDef<any> | undefined = undefined,
>(
  options: LeafCommandOptions<A, P>,
): LeafCommand<InferArgs<A>, InferPositionals<P>>;
export function command(
  options: ParentCommandOptions,
): ParentCommand;
export function command<
  A extends ArgsDef<any> | undefined = undefined,
  P extends PositionalsDef<any> | undefined = undefined,
>(
  options: CommandOptions<A, P>,
): CommandNode {
  const hasCommands = options.commands && Object.keys(options.commands).length > 0;

  if (hasCommands && options.handler) {
    throw new TypeError("Parent command cannot define a handler");
  }

  if (!hasCommands && !options.handler) {
    throw new TypeError("Leaf command requires a handler");
  }

  if (hasCommands) {
    // Parent command — attach names to children for routing.
    const namedChildren: Record<string, NamedParent | NamedLeaf> = {};
    for (const [name, child] of Object.entries(options.commands!)) {
      namedChildren[name] = Object.assign(child as any, { __name__: name }) as any;
    }

    return {
      __brand__: "parent",
      description: options.description,
      commands: namedChildren,
    };
  }

  // Leaf command — store argsDef reference for routing / help.
  const leaf: NamedLeaf = {
    __brand__: "leaf",
    description: options.description,
    handler: options.handler! as any,
  };

  if (options.args) {
    leaf.argsDef = options.args;
  }

  if (options.positionals) {
    leaf.positionalsDef = options.positionals;
  }

  return leaf;
}

// ---------------------------------------------------------------------------
// Type-level helpers — extract command info for the runner.
// ---------------------------------------------------------------------------

/** Get all leaf commands recursively, flattened with their full path */
export interface FlattenedCommand {
  /** Full CLI path, e.g. "users create" */
  path: string;
  name: string; // last segment only
  command: LeafCommand<any>;
}

export function flattenCommands(
  commands: Record<string, CommandNode>,
  prefix = "",
): FlattenedCommand[] {
  const results: FlattenedCommand[] = [];

  for (const [name, node] of Object.entries(commands)) {
    const path = prefix ? `${prefix} ${name}` : name;

    if (node.__brand__ === "leaf") {
      // Leaf — it's a terminal command.
      results.push({ path, name, command: node as LeafCommand<any> });
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
  | { type: "leaf"; command: LeafCommand<any, any>; remainingArgs: string[] }
  | { type: "parent_help"; commands: Record<string, CommandNode>; description?: string };

/** Resolve which command node to execute given an argv token list */
export function resolveCommand(
  rootCommands: Record<string, CommandNode>,
  tokens: string[],
): ResolveResult | null {
  let current = rootCommands;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Check for --help / -h mid-path — show help for the parent level.
    if (token === "--help" || token === "-h") {
      return { type: "parent_help", commands: current };
    }

    if (!Object.hasOwn(current, token)) return null; // path not found.

    const node = current[token]!;

    if (node.__brand__ === "leaf") {
      // Reached a leaf — remaining argv are the command's arguments.
      return { type: "leaf", command: node as LeafCommand<any, any>, remainingArgs: tokens.slice(i + 1) };
    }

    // Parent — descend into its children.
    current = node.commands;
    i++;
  }

  // We ran out of tokens but are at a parent (no leaf reached).
  return { type: "parent_help", commands: current };
}
