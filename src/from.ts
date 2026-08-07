import { z } from "zod";
import type { ArgsDef, ParsedArgOption } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers — inspect Zod schema to determine parseArgs option shape.
// These work with the public _def introspection that is stable across Zod v3.
// ---------------------------------------------------------------------------

type BaseKind = "string" | "number" | "boolean" | "array" | "enum";

/** Unwrap optional / default / effects layers and return the innermost base kind */
function resolveBaseKind(type: z.ZodTypeAny): BaseKind {
  // Iteratively unwrap all wrapper types to reach the base.
  let current = type;
  while (true) {
    switch (current._def.typeName) {
      case "ZodOptional":
        current = current._def.innerType; // ZodOptional wraps in _def.innerType since v3.20+
        continue;
      case "ZodDefault":
        current = current._def.innerType;
        continue;
      case "ZodEffects":
        current = current._def.schema as z.ZodTypeAny;
        continue;
      default:
        break;
    }
    break; // Reached the base type.
  }

  const base = current;
  switch (base._def.typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodEnum":
    case "ZodNativeEnum":
      return "enum";
    default:
      // Fallback — treat everything else as string (covers coerce, literals, etc.)
      return "string";
  }
}

/** Extract the .describe() text for a Zod type. */
function describeOf(type: z.ZodTypeAny): string | undefined {
  // Check each wrapping layer — describe() may live on any level.
  let current = type;
  while (true) {
    const desc = (current as any)._def.description;
    if (desc !== undefined && desc !== null) return desc;

    switch (current._def.typeName) {
      case "ZodOptional":
        current = current._def.innerType;
        continue;
      case "ZodDefault":
        current = current._def.innerType;
        continue;
      case "ZodEffects":
        current = current._def.schema as any;
        continue;
      default:
        break;
    }
    break; // Reached the base type without finding a description.
  }

  return undefined;
}

/** Unwrap optional / default / effects to reach the base Zod type */
function unwrapToBase(type: z.ZodTypeAny): z.ZodTypeAny {
  let current = type as any;
  while (true) {
    switch (current._def.typeName) {
      case "ZodOptional":
        current = current._def.innerType;
        continue;
      case "ZodDefault":
        current = current._def.innerType;
        continue;
      case "ZodEffects":
        current = current._def.schema as any;
        continue;
      default:
        return current;
    }
  }
}

/** Build a parseArgs option definition for one schema key */
function buildOption(
  kind: BaseKind,
  alias?: string,
): ParsedArgOption & { multiple?: boolean; choices?: readonly (string | number)[] } {
  const opt = {} as ParsedArgOption & {
    kind?: BaseKind;
    multiple?: boolean;
    choices?: readonly (string | number)[];
  };
  opt.kind = kind;

  switch (kind) {
    case "boolean":
      opt.type = "boolean";
      break;
    default:
      // All non-boolean values arrive as strings from parseArgs — Zod coercion handles the rest.
      opt.type = "string";
      if (kind === "array") opt.multiple = true;
  }

  if (alias) {
    opt.short = alias;
  }

  return opt;
}

// ---------------------------------------------------------------------------
// Public API — zargv.from(schema, options?)
// ---------------------------------------------------------------------------

export interface FromOptions<T extends z.AnyZodObject = z.AnyZodObject>
{
  /** Map of canonical key → short CLI flag character. Keys must match schema property names. */
  aliases?: Partial<Record<keyof T["shape"], string>>;
}

/** Internal shape returned by `from()` — carries schema type for inference. */
interface ArgsDefInternal<T extends z.AnyZodObject> {
  __zargv_schema__: T;
  _aliases: Record<string, string>;
  _parseArgsConfig: Record<string, any>;
  _describeMap: Map<string, string | undefined>;
  _optionalMap: Map<string, boolean>;
  _defaultMap: Map<string, unknown>;
}

interface FieldMeta {
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

/** Extract optional/default metadata from schema wrappers around a field. */
function fieldMetaOf(type: z.ZodTypeAny): FieldMeta {
  let current = type as any;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;

  while (true) {
    switch (current._def.typeName) {
      case "ZodOptional":
        optional = true;
        current = current._def.innerType;
        continue;
      case "ZodDefault":
        optional = true;
        hasDefault = true;
        defaultValue = current._def.defaultValue();
        current = current._def.innerType;
        continue;
      case "ZodEffects":
        current = current._def.schema;
        continue;
      default:
        return { optional, hasDefault, defaultValue };
    }
  }
}

/**
 * Convert a Zod object schema into an args definition that can be passed to
 * `zargv.command()`. The returned value carries the original Zod type through
 * TypeScript generics so handler inference works automatically.
 */
export function from<T extends z.AnyZodObject>(
  schema: T,
  options?: FromOptions<T>,
): ArgsDefInternal<T> {
  const aliases = options?.aliases ?? {};

  if (schema._def.typeName !== "ZodObject") {
    throw new TypeError("zargv.from() requires a ZodObject schema");
  }

  const shape = schema.shape;

  // Build parseArgs options and describe map from each key.
  const parseOptions: Record<string, any> = {};
  const describeMap = new Map<string, string | undefined>();
  const optionalMap = new Map<string, boolean>();
  const defaultMap = new Map<string, unknown>();

  for (const [key, fieldSchema] of Object.entries(shape as Record<string, z.ZodTypeAny>)) {
    const kind = resolveBaseKind(fieldSchema);
    const alias = key in aliases ? (aliases as Record<string, string | undefined>)[key] : undefined;
    const meta = fieldMetaOf(fieldSchema);
    parseOptions[key] = buildOption(kind, alias);

    // For enums / native enums, pass choices to parseArgs so --help can show them.
    if (kind === "enum") {
      const base = unwrapToBase(fieldSchema as z.ZodTypeAny);
      if (base._def.typeName === "ZodEnum") {
        parseOptions[key].choices = base._def.values;
      } else if (base._def.typeName === "ZodNativeEnum") {
        const enumObj = base._def.values as Record<string, string | number>;
        parseOptions[key].choices = Object.entries(enumObj)
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .map(([, v]) => String(v));
      }
    }

    describeMap.set(key, describeOf(fieldSchema as z.ZodTypeAny));
    optionalMap.set(key, meta.optional);
    if (meta.hasDefault) defaultMap.set(key, meta.defaultValue);
  }

  return {
    __zargv_schema__: schema,
    _aliases: aliases,
    _parseArgsConfig: parseOptions,
    _describeMap: describeMap,
    _optionalMap: optionalMap,
    _defaultMap: defaultMap,
  };
}
