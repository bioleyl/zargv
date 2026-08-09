import type { z } from 'zod';
import type { ParsedArgOption } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — inspect Zod schema to determine parseArgs option shape.
// These work with the public _def introspection that is stable across Zod v3.
// ---------------------------------------------------------------------------

type BaseKind = 'string' | 'number' | 'boolean' | 'array' | 'enum';
type InternalParseOption = ParsedArgOption & { multiple?: boolean; choices?: readonly (string | number)[] };

type ZodDefLike = {
  typeName: string;
  description?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  values?: readonly string[] | Record<string, string | number>;
  defaultValue?: () => unknown;
};

function getDef(type: z.ZodTypeAny): ZodDefLike {
  return (type as unknown as { _def: ZodDefLike })._def;
}

/** Unwrap optional / default / effects layers and return the innermost base kind */
function resolveBaseKind(type: z.ZodTypeAny): BaseKind {
  // Iteratively unwrap all wrapper types to reach the base.
  let current = type;
  while (true) {
    const def = getDef(current);
    switch (def.typeName) {
      case 'ZodOptional':
        if (!def.innerType) {
          break;
        }
        current = def.innerType; // ZodOptional wraps in _def.innerType since v3.20+
        continue;
      case 'ZodDefault':
        if (!def.innerType) {
          break;
        }
        current = def.innerType;
        continue;
      case 'ZodEffects':
        if (!def.schema) {
          break;
        }
        current = def.schema;
        continue;
      default:
        break;
    }
    break; // Reached the base type.
  }

  const base = current;
  switch (getDef(base).typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray':
      return 'array';
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return 'enum';
    default:
      // Fallback — treat everything else as string (covers coerce, literals, etc.)
      return 'string';
  }
}

/** Extract the .describe() text for a Zod type. */
function describeOf(type: z.ZodTypeAny): string | undefined {
  // Check each wrapping layer — describe() may live on any level.
  let current = type;
  while (true) {
    const def = getDef(current);
    const desc = def.description;
    if (desc !== undefined && desc !== null) {
      return desc;
    }

    switch (def.typeName) {
      case 'ZodOptional':
        if (!def.innerType) {
          break;
        }
        current = def.innerType;
        continue;
      case 'ZodDefault':
        if (!def.innerType) {
          break;
        }
        current = def.innerType;
        continue;
      case 'ZodEffects':
        if (!def.schema) {
          break;
        }
        current = def.schema;
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
  let current = type;
  while (true) {
    const def = getDef(current);
    switch (def.typeName) {
      case 'ZodOptional':
        if (!def.innerType) {
          return current;
        }
        current = def.innerType;
        continue;
      case 'ZodDefault':
        if (!def.innerType) {
          return current;
        }
        current = def.innerType;
        continue;
      case 'ZodEffects':
        if (!def.schema) {
          return current;
        }
        current = def.schema;
        continue;
      default:
        return current;
    }
  }
}

/** Build a parseArgs option definition for one schema key */
function buildOption(
  kind: BaseKind,
  alias?: string
): ParsedArgOption & { multiple?: boolean; choices?: readonly (string | number)[] } {
  const opt = {} as ParsedArgOption & {
    kind?: BaseKind;
    multiple?: boolean;
    choices?: readonly (string | number)[];
  };
  opt.kind = kind;

  switch (kind) {
    case 'boolean':
      opt.type = 'boolean';
      break;
    default:
      // All non-boolean values arrive as strings from parseArgs — Zod coercion handles the rest.
      opt.type = 'string';
      if (kind === 'array') {
        opt.multiple = true;
      }
  }

  if (alias) {
    opt.short = alias;
  }

  return opt;
}

// ---------------------------------------------------------------------------
// Public API — zargv.from(schema, options?)
// ---------------------------------------------------------------------------

export interface FromOptions<T extends z.AnyZodObject = z.AnyZodObject> {
  /** Map of canonical key → short CLI flag character. Keys must match schema property names. */
  aliases?: Partial<Record<keyof T['shape'], string>>;
}

/** Internal shape returned by `from()` — carries schema type for inference. */
interface ArgsDefInternal<T extends z.AnyZodObject> {
  // biome-ignore lint/style/useNamingConvention: Internal brand key is intentionally namespaced.
  __zargv_schema__: T;
  _aliases: Record<string, string>;
  _parseArgsConfig: Record<string, InternalParseOption>;
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
  let current = type;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;

  while (true) {
    const def = getDef(current);
    switch (def.typeName) {
      case 'ZodOptional':
        optional = true;
        if (!def.innerType) {
          return { defaultValue, hasDefault, optional };
        }
        current = def.innerType;
        continue;
      case 'ZodDefault':
        optional = true;
        hasDefault = true;
        defaultValue = def.defaultValue ? def.defaultValue() : undefined;
        if (!def.innerType) {
          return { defaultValue, hasDefault, optional };
        }
        current = def.innerType;
        continue;
      case 'ZodEffects':
        if (!def.schema) {
          return { defaultValue, hasDefault, optional };
        }
        current = def.schema;
        continue;
      default:
        return { defaultValue, hasDefault, optional };
    }
  }
}

/**
 * Convert a Zod object schema into an args definition that can be passed to
 * `zargv.command()`. The returned value carries the original Zod type through
 * TypeScript generics so handler inference works automatically.
 */
export function from<T extends z.AnyZodObject>(schema: T, options?: FromOptions<T>): ArgsDefInternal<T> {
  const aliases = options?.aliases ?? {};

  if (schema._def.typeName !== 'ZodObject') {
    throw new TypeError('zargv.from() requires a ZodObject schema');
  }

  const shape = schema.shape;

  // Build parseArgs options and describe map from each key.
  const parseOptions: Record<string, InternalParseOption> = {};
  const describeMap = new Map<string, string | undefined>();
  const optionalMap = new Map<string, boolean>();
  const defaultMap = new Map<string, unknown>();

  for (const [key, fieldSchema] of Object.entries(shape as Record<string, z.ZodTypeAny>)) {
    const kind = resolveBaseKind(fieldSchema);
    const alias = key in aliases ? (aliases as Record<string, string | undefined>)[key] : undefined;
    const meta = fieldMetaOf(fieldSchema);
    parseOptions[key] = buildOption(kind, alias);

    // For enums / native enums, pass choices to parseArgs so --help can show them.
    if (kind === 'enum') {
      const base = unwrapToBase(fieldSchema as z.ZodTypeAny);
      const baseDef = getDef(base);
      if (baseDef.typeName === 'ZodEnum' && Array.isArray(baseDef.values)) {
        parseOptions[key].choices = baseDef.values;
      } else if (baseDef.typeName === 'ZodNativeEnum' && baseDef.values && !Array.isArray(baseDef.values)) {
        const enumObj = baseDef.values;
        parseOptions[key].choices = Object.entries(enumObj)
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .map(([, v]) => String(v));
      }
    }

    describeMap.set(key, describeOf(fieldSchema as z.ZodTypeAny));
    optionalMap.set(key, meta.optional);
    if (meta.hasDefault) {
      defaultMap.set(key, meta.defaultValue);
    }
  }

  return {
    // biome-ignore lint/style/useNamingConvention: Internal brand key is intentionally namespaced.
    __zargv_schema__: schema,
    _aliases: aliases,
    _defaultMap: defaultMap,
    _describeMap: describeMap,
    _optionalMap: optionalMap,
    _parseArgsConfig: parseOptions,
  };
}
