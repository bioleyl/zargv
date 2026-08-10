import type { z } from 'zod';
import type { ParsedArgOption } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — inspect Zod schema to determine parseArgs option shape.
// These work with the public _def introspection that is stable across Zod v3.
// ---------------------------------------------------------------------------

type BaseKind = 'string' | 'number' | 'boolean' | 'array' | 'enum';
type InternalParseOption = ParsedArgOption & { multiple?: boolean; choices?: readonly (string | number)[] };

type ZodDefLike = {
  typeName?: string;
  type?: string;
  description?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  in?: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  valueType?: z.ZodTypeAny;
  values?: readonly string[] | Record<string, string | number>;
  entries?: Record<string, string | number>;
  defaultValue?: unknown;
};

function readDefaultValue(value: unknown): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

function getDef(type: z.ZodTypeAny): ZodDefLike {
  return (type as unknown as { _def: ZodDefLike })._def;
}

function getTypeTag(type: z.ZodTypeAny): string {
  const def = getDef(type);
  // Zod v3 uses `_def.typeName`; v4 may expose a shorter `_def.type` tag.
  return def.typeName ?? def.type ?? '';
}

function isWrapperTag(tag: string): boolean {
  return [
    // v3 wrappers
    'ZodOptional',
    'ZodDefault',
    'ZodEffects',
    'ZodPipeline',
    'ZodTransform',
    // v4-style tags
    'optional',
    'default',
    'effects',
    'pipe',
    'transform',
  ].includes(tag);
}

function isZodType(value: unknown): value is z.ZodTypeAny {
  return typeof value === 'object' && value !== null && 'safeParse' in value;
}

function nextWrappedType(type: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = getDef(type);
  const tag = getTypeTag(type);

  if (!isWrapperTag(tag)) {
    return undefined;
  }

  // Different Zod versions/wrappers store the wrapped schema under different keys.
  const candidates: unknown[] = [def.innerType, def.schema, def.in, def.out];
  return candidates.find(isZodType);
}

/** Unwrap optional / default / effects layers and return the innermost base kind */
function resolveBaseKind(type: z.ZodTypeAny): BaseKind {
  // Iteratively unwrap all wrapper types to reach the base.
  let current = type;
  while (true) {
    const next = nextWrappedType(current);
    if (!next) {
      break;
    }
    current = next;
  }

  switch (getTypeTag(current)) {
    // v3 + v4 scalar tags
    case 'ZodString':
    case 'string':
      return 'string';
    case 'ZodNumber':
    case 'number':
      return 'number';
    case 'ZodBoolean':
    case 'boolean':
      return 'boolean';
    case 'ZodArray':
    case 'array':
      return 'array';
    case 'ZodEnum':
    case 'ZodNativeEnum':
    // v4 enum/nativeEnum tags
    case 'enum':
    case 'nativeEnum':
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

    const next = nextWrappedType(current);
    if (!next) {
      break;
    }
    current = next;
  }

  return undefined;
}

/** Unwrap optional / default / effects to reach the base Zod type */
function unwrapToBase(type: z.ZodTypeAny): z.ZodTypeAny {
  let current = type;
  while (true) {
    const next = nextWrappedType(current);
    if (!next) {
      return current;
    }
    current = next;
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

type ZodSchemaLike = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): unknown;
};

// Keep this structural so both Zod v3 and v4 object schemas are accepted.
type ZodObjectLike = ZodSchemaLike & { shape: Record<string, unknown> };

export interface FromOptions<T extends ZodObjectLike = ZodObjectLike> {
  /** Map of canonical key → short CLI flag character. Keys must match schema property names. */
  aliases?: Partial<Record<Extract<keyof T['shape'], string>, string>>;
}

/** Internal shape returned by `from()` — carries schema type for inference. */
interface ArgsDefInternal<T extends ZodObjectLike> {
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
    const tag = getTypeTag(current);
    switch (tag) {
      case 'ZodOptional':
      case 'optional':
        optional = true;
        if (!def.innerType || !isZodType(def.innerType)) {
          return { defaultValue, hasDefault, optional };
        }
        current = def.innerType;
        continue;
      case 'ZodDefault':
      case 'default':
        optional = true;
        hasDefault = true;
        defaultValue = readDefaultValue(def.defaultValue);
        if (!def.innerType || !isZodType(def.innerType)) {
          return { defaultValue, hasDefault, optional };
        }
        current = def.innerType;
        continue;
      case 'ZodEffects':
      case 'effects':
      case 'ZodPipeline':
      case 'pipe':
      case 'ZodTransform':
      case 'transform': {
        const next = nextWrappedType(current);
        if (!next) {
          return { defaultValue, hasDefault, optional };
        }
        current = next;
        continue;
      }
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
export function from<T extends ZodObjectLike>(schema: T, options?: FromOptions<T>): ArgsDefInternal<T> {
  const aliases = options?.aliases ?? {};

  // Tag inspection still uses Zod internals; cast stays local to avoid leaking
  // version-specific class constraints into the public from() signature.
  const schemaTag = getTypeTag(schema as unknown as z.ZodTypeAny);
  // v3 object tag (`ZodObject`) and v4 object tag (`object`).
  if (schemaTag !== 'ZodObject' && schemaTag !== 'object') {
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
      const baseTag = getTypeTag(base);
      // v3 enum stores options in `_def.values`.
      if ((baseTag === 'ZodEnum' || baseTag === 'enum') && Array.isArray(baseDef.values)) {
        parseOptions[key].choices = baseDef.values;
      } else if (
        // v3 native enum stores key/value object in `_def.values`.
        (baseTag === 'ZodNativeEnum' || baseTag === 'nativeEnum')
        && baseDef.values
        && !Array.isArray(baseDef.values)
      ) {
        const enumObj = baseDef.values;
        parseOptions[key].choices = Object.entries(enumObj)
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
          .map(([, v]) => String(v));
      } else if (baseDef.entries) {
        // v4 may expose enum entries under `_def.entries`.
        const enumObj = baseDef.entries;
        parseOptions[key].choices = Object.values(enumObj)
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .map((v) => String(v));
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
