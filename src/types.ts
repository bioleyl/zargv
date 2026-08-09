import type { z } from 'zod';

// ---------------------------------------------------------------------------
// ArgsDef — carries the original Zod schema type through generics so that
// `command()` can infer handler argument types without re-parsing schemas.
// ---------------------------------------------------------------------------

export interface ArgsDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Internal brand — never used at runtime, only for TypeScript inference */
  // biome-ignore lint/style/useNamingConvention: Internal brand key is intentionally namespaced.
  __zargv_schema__: T;
}

export interface PositionalsDef<T = unknown> {
  /** Internal usage text shown in help output */
  _usage: string;
  /** Internal parser that validates/transforms positional tokens */
  _parsePositionals(positionals: string[]): T;
}

/** Extract the Zod schema type from an ArgsDef wrapper */
export type UnwrapArgsDef<A> = A extends ArgsDef<infer T> ? T : never;

/** Infer handler args from an ArgsDef (or void when absent). */
export type InferArgs<A extends ArgsDef | undefined> = A extends ArgsDef<infer T> ? z.output<T> : undefined;

/** Infer handler positionals from a PositionalsDef (or undefined when absent). */
export type InferPositionals<P extends PositionalsDef | undefined> =
  P extends PositionalsDef<infer T> ? T : undefined;

/** Internal helper for command() options typed from args/positionals defs. */
export type DefsHandlerCtx<A extends ArgsDef | undefined, P extends PositionalsDef | undefined> = {
  args: InferArgs<A>;
  positionals: InferPositionals<P>;
};

/**
 * Public context type helper for external handlers.
 *
 * Use as: HandlerCtx<typeof someCommand>
 */
export type HandlerCtx<C extends LeafCommand<never, never>> =
  C extends LeafCommand<infer A, infer Pos> ? { args: A; positionals: Pos } : never;

// ---------------------------------------------------------------------------
// Command node types
// ---------------------------------------------------------------------------

export type HandlerContext<TArgs = undefined, TPositionals = undefined> = {
  args: TArgs;
  positionals: TPositionals;
};

export type CommandHandler<Ctx extends HandlerContext<unknown, unknown>> = (ctx: Ctx) => Promise<void> | void;

/** A leaf command that has a handler but no sub-commands */
export interface LeafCommand<ArgsType = undefined, PositionalsType = undefined> {
  __brand__: 'leaf';
  description?: string;
  argsDef?: ArgsDef;
  positionalsDef?: PositionalsDef;
  /** Handler — typed at the call site via `command()` generics. */
  handler:
    | CommandHandler<{ args: ArgsType; positionals: PositionalsType }>
    | ((ctx: { args: unknown; positionals: unknown }) => Promise<void> | void);
}

/** A parent command that has sub-commands but no handler of its own */
export interface ParentCommand {
  __brand__: 'parent';
  description?: string;
  commands: Record<string, CommandNode>;
}

/** Union type for any command node */
export type CommandNode = LeafCommand<never, never> | ParentCommand;

// ---------------------------------------------------------------------------
// parseArgs option-type mapping helpers (internal)
// ---------------------------------------------------------------------------

export interface ParsedArgOption {
  type: 'string' | 'boolean';
  short?: string;
}
