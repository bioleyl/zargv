/** biome-ignore-all lint/style/useNamingConvention: Zod key names */
import { z } from 'zod';

import type { ParsedArgOption } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — inspect Zod schema to determine parseArgs option shape.
// ---------------------------------------------------------------------------

type BaseKind = 'string' | 'number' | 'boolean' | 'array' | 'enum';
type InternalParseOption = ParsedArgOption & { multiple?: boolean; choices?: readonly (string | number)[] };
type AliasesMap = Record<string, string>;

type ZodDefLike = {
  type: string;
  innerType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  entries?: Record<string, string | number>;
  defaultValue?: unknown;
};

const WRAPPER_TAGS = new Set(['optional', 'default', 'pipe']);

const KIND_BY_TAG: Record<string, BaseKind | undefined> = {
  array: 'array',
  boolean: 'boolean',
  enum: 'enum',
  number: 'number',
  string: 'string',
};

function getDef(type: z.ZodType): ZodDefLike {
  return type.def as ZodDefLike;
}

function getTypeTag(type: z.ZodType): string {
  return getDef(type).type;
}

function isWrapperTag(tag: string): boolean {
  return WRAPPER_TAGS.has(tag);
}

function isZodType(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

function nextWrappedType(type: z.ZodType): z.ZodType | undefined {
  const def = getDef(type);
  const tag = getTypeTag(type);

  if (!isWrapperTag(tag)) {
    return undefined;
  }

  const candidates: unknown[] = [def.innerType, def.in, def.out];
  return candidates.find(isZodType);
}

interface TypeLayer {
  def: ZodDefLike;
  tag: string;
  type: z.ZodType;
}

function collectTypeLayers(type: z.ZodType): TypeLayer[] {
  const layers: TypeLayer[] = [];
  let current = type;

  while (true) {
    const layer = {
      def: getDef(current),
      tag: getTypeTag(current),
      type: current,
    };
    layers.push(layer);

    const next = nextWrappedType(current);
    if (!next) {
      return layers;
    }

    current = next;
  }
}

function baseLayerOf(type: z.ZodType): TypeLayer {
  const layers = collectTypeLayers(type);
  return layers[layers.length - 1] as TypeLayer;
}

/** Unwrap optional / default / effects layers and return the innermost base kind */
function resolveBaseKind(type: z.ZodType): BaseKind {
  const kind = KIND_BY_TAG[baseLayerOf(type).tag];
  return kind ?? 'string';
}

/** Extract the .describe() text for a Zod type. */
function describeOf(type: z.ZodType): string | undefined {
  for (const layer of collectTypeLayers(type)) {
    const description = z.globalRegistry.get(layer.type)?.description;
    if (description !== undefined) {
      return description;
    }
  }

  return undefined;
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

function enumChoicesFrom(baseLayer: TypeLayer): readonly (string | number)[] | undefined {
  const { def } = baseLayer;

  if (def.entries) {
    const enumObj = def.entries;
    return Object.values(enumObj)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => String(v));
  }

  return undefined;
}

function aliasForKey(aliases: AliasesMap, key: string): string | undefined {
  return key in aliases ? aliases[key] : undefined;
}

function objectShapeFromSchema(schema: z.ZodObject): Record<string, z.ZodType> {
  return schema.shape;
}

interface FieldConfig {
  defaultValue?: unknown;
  describe?: string;
  hasDefault: boolean;
  key: string;
  optional: boolean;
  parseOption: InternalParseOption;
}

function buildFieldConfig(key: string, fieldSchema: z.ZodType, aliases: AliasesMap): FieldConfig {
  const kind = resolveBaseKind(fieldSchema);
  const parseOption = buildOption(kind, aliasForKey(aliases, key));
  const meta = fieldMetaOf(fieldSchema);
  const choices = kind === 'enum' ? enumChoicesFrom(baseLayerOf(fieldSchema)) : undefined;

  if (choices) {
    parseOption.choices = choices;
  }

  return {
    defaultValue: meta.defaultValue,
    describe: describeOf(fieldSchema),
    hasDefault: meta.hasDefault,
    key,
    optional: meta.optional,
    parseOption,
  };
}

// ---------------------------------------------------------------------------
// Public API — zargv.from(schema, options?)
// ---------------------------------------------------------------------------

export interface FromOptions<T extends z.ZodObject = z.ZodObject> {
  /** Map of canonical key → short CLI flag character. Keys must match schema property names. */
  aliases?: Partial<Record<Extract<keyof T['shape'], string>, string>>;
}

/** Internal shape returned by `from()` — carries schema type for inference. */
interface ArgsDefInternal<T extends z.ZodObject> {
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
function fieldMetaOf(type: z.ZodType): FieldMeta {
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;

  for (const { def, tag } of collectTypeLayers(type)) {
    switch (tag) {
      case 'optional':
        optional = true;
        break;
      case 'default':
        optional = true;
        hasDefault = true;
        defaultValue = def.defaultValue;
        break;
      case 'pipe':
        break;
      default:
        return { defaultValue, hasDefault, optional };
    }
  }

  return { defaultValue, hasDefault, optional };
}

/**
 * Convert a Zod object schema into an args definition that can be passed to
 * `zargv.command()`. The returned value carries the original Zod type through
 * TypeScript generics so handler inference works automatically.
 */
export function from<T extends z.ZodObject>(schema: T, options?: FromOptions<T>): ArgsDefInternal<T> {
  const aliases: AliasesMap = {};
  const rawAliases = options?.aliases as Record<string, string | undefined> | undefined;
  if (rawAliases) {
    for (const [key, alias] of Object.entries(rawAliases)) {
      if (alias !== undefined) {
        aliases[key] = alias;
      }
    }
  }

  if (getTypeTag(schema) !== 'object') {
    throw new TypeError('zargv.from() requires a ZodObject schema');
  }

  const shape = objectShapeFromSchema(schema);

  // Build parseArgs options and describe map from each key.
  const parseOptions: Record<string, InternalParseOption> = {};
  const describeMap = new Map<string, string | undefined>();
  const optionalMap = new Map<string, boolean>();
  const defaultMap = new Map<string, unknown>();

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const config = buildFieldConfig(key, fieldSchema, aliases);

    parseOptions[key] = config.parseOption;
    describeMap.set(config.key, config.describe);
    optionalMap.set(config.key, config.optional);
    if (config.hasDefault) {
      defaultMap.set(config.key, config.defaultValue);
    }
  }

  return {
    __zargv_schema__: schema,
    _aliases: aliases,
    _defaultMap: defaultMap,
    _describeMap: describeMap,
    _optionalMap: optionalMap,
    _parseArgsConfig: parseOptions,
  };
}
