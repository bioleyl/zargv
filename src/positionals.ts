import { z } from 'zod';

import type { PositionalsDef } from './types.js';

type SplitLastTuple = readonly [readonly [string, z.ZodTypeAny], readonly [string, z.ZodTypeAny]];

type SingleTuple = readonly [string, z.ZodTypeAny];

type SplitLastOutput<T extends SplitLastTuple> = { [K in T[0][0]]: z.output<T[0][1]> } & {
  [K in T[1][0]]: z.output<T[1][1]>;
};

type SingleOutput<T extends SingleTuple> = { [K in T[0]]: z.output<T[1]> };

function toOperandLabel(name: string, repeatable: boolean): string {
  const base = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  return repeatable ? `${base}...` : base;
}

function buildUsage(restKey: string, lastKey: string): string {
  return `${toOperandLabel(restKey, true)} ${toOperandLabel(lastKey, false)}`;
}

function parseSplitLastPositionals<T extends SplitLastTuple>(tuple: T, positionals: string[]): SplitLastOutput<T> {
  const [[restKey, restSchema], [lastKey, lastSchema]] = tuple;

  if (restKey === lastKey) {
    throw new TypeError('splitLast positionals must use distinct names');
  }

  if (positionals.length === 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Missing required positional argument: ${lastKey}`,
        path: [lastKey],
      },
    ]);
  }

  const restInput = positionals.slice(0, -1);
  const lastInput = positionals[positionals.length - 1];

  const restParsed = restSchema.parse(restInput);
  const lastParsed = lastSchema.parse(lastInput);

  return {
    [restKey]: restParsed,
    [lastKey]: lastParsed,
  } as SplitLastOutput<T>;
}

function splitLast<const T extends SplitLastTuple>(tuple: T): PositionalsDef<SplitLastOutput<T>> {
  const [[restKey], [lastKey]] = tuple;

  return {
    _parsePositionals(positionals: string[]): SplitLastOutput<T> {
      return parseSplitLastPositionals(tuple, positionals);
    },
    _usage: buildUsage(restKey, lastKey),
  };
}

function parseSinglePositionals<T extends SingleTuple>(tuple: T, positionals: string[]): SingleOutput<T> {
  const [key, schema] = tuple;

  if (positionals.length === 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Missing required positional argument: ${key}`,
        path: [key],
      },
    ]);
  }

  if (positionals.length > 1) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Too many positional arguments. Expected exactly 1 (${key})`,
        path: [key],
      },
    ]);
  }

  const parsed = schema.parse(positionals[0]);
  return { [key]: parsed } as SingleOutput<T>;
}

function single<const T extends SingleTuple>(tuple: T): PositionalsDef<SingleOutput<T>> {
  const [key] = tuple;

  return {
    _parsePositionals(positionals: string[]): SingleOutput<T> {
      return parseSinglePositionals(tuple, positionals);
    },
    _usage: toOperandLabel(key, false),
  };
}

export const positionals = {
  single,
  splitLast,
};
