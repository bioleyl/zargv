# zargv

A **type-safe CLI framework** powered by [Zod](https://zod.dev). Define your command tree once, validate everything through schemas you already trust, and keep handler types inferred end-to-end.

## Table of Contents

1. [Installation](#installation)
2. [First Example: A Command Without Arguments](#first-example-a-command-without-arguments)
3. [Adding Options with `--flag <value>`](#adding-options-with---flag-value)
4. [Boolean Flags (`--verbose`)](#boolean-flags----verbose)
5. [Default Values](#default-values)
6. [Positional Arguments: A Single Operand](#positional-arguments-a-single-operand)
7. [Positional Arguments: Multiple Operands](#positional-arguments-multiple-operands)
8. [Composing a Command Tree](#composing-a-command-tree)
9. [External Handlers with `HandlerCtx`](#external-handlers-with-handlerctx)
10. [API Reference](#api-reference)

---

## Installation

```bash
npm install zargv zod
```

---

## First Example: A Command Without Arguments

The simplest form — a command that does something, without any arguments:

```ts
import { zargv } from "zargv";

export default zargv.command({
  description: "Print a greeting",

  async handler() {
    console.log("Hello!");
  },
});
```

Usage :

```bash
$ mycli greet
Hello!
```

---

## Adding Options with `--flag <value>`

To accept named arguments, use `zargv.from()` which converts a Zod schema into an options definition:

```ts
import { z } from "zod";
import { zargv } from "zargv";

export default zargv.command({
  description: "Greet a user by name",

  args: zargv.from(
    z.object({
      name: z.string().describe("User to greet"),
    }),
  ),

  async handler({ args }) {
    // TypeScript knows: args.name is string
    console.log(`Hello, ${args.name}!`);
  },
});
```

Usage :

```bash
$ mycli greet --name Alice
Hello, Alice!
```

Short aliases are optional:

```ts
zargv.from(
  z.object({ name: z.string() }),
  { aliases: { name: "n" } }, // now both -n and --name work
);
```

---

## Boolean Flags (`--verbose`)

Booleans act as flags: the presence of the flag activates the value, its absence deactivates it.

```ts
import { z } from "zod";
import { zargv } from "zargv";

export default zargv.command({
  description: "Run a build",

  args: zargv.from(
    z.object({
      verbose: z.boolean().describe("Enable verbose output"),
    }),
  ),

  async handler({ args }) {
    if (args.verbose) {
      console.log("[verbose] Starting build...");
    } else {
      console.log("Building...");
    }
  },
});
```

Usage :

```bash
$ mycli build          # → Building...
$ mycli build --verbose # → [verbose] Starting build...
```

---

## Default Values

When an option has a default value, it becomes optional — the flag does not appear in the usage signature.

```ts
import { z } from "zod";
import { zargv } from "zargv";

export default zargv.command({
  description: "Create a user",

  args: zargv.from(
    z.object({
      name:   z.string().describe("User display name"),
      admin:  z.boolean().default(false).describe("Grant administrator privileges"),
    }),
  ),

  async handler({ args }) {
    console.log(`Creating user ${args.name} (admin=${args.admin})`);
  },
});
```

Usage :

```bash
$ mycli users create --name Bob          # → Creating user Bob (admin=false)
$ mycli users create -n Alice --admin    # → Creating user Alice (admin=true)
```

---

## Positional Arguments: A Single Operand

For commands that accept exactly **one** positional argument, use `zargv.positionals.single()`:

```ts
import { z } from "zod";
import { zargv } from "zargv";

export default zargv.command({
  description: "Stage a destination",

  positionals: zargv.positionals.single([
    "destination",
    z.string(),
  ]),

  async handler({ positionals }) {
    // TypeScript knows: positionals.destination is string
    console.log(`Staging to ${positionals.destination}`);
  },
});
```

Usage :

```bash
$ mycli stage dist/       # → Staging to dist/
$ mycli stage             # → Error: exactly one operand required
$ mycli stage a b         # → Error: too many operands
```

---

## Positional Arguments: Multiple Operands

For commands with **multiple** positional arguments, use `zargv.positionals.splitLast()` — it splits all operands except the last into a group, and keeps the last one separate. This is the classic pattern of `cp SOURCE... DEST` or `mv SOURCE... DIR`:

```ts
import { z } from "zod";
import { zargv } from "zargv";

export default zargv.command({
  description: "Move files",

  args: zargv.from(
    z.object({ force: z.boolean().default(false) }),
    { aliases: { force: "f" } },
  ),

  positionals: zargv.positionals.splitLast([
    ["sources",   z.array(z.string()).min(1)],
    ["directory", z.string()],
  ]),

  async handler({ args, positionals }) {
    // args.force: boolean
    // positionals.sources: string[]
    // positionals.directory: string
    console.log(args.force, positionals.sources, positionals.directory);
  },
});
```

Usage :

```bash
$ mycli mv file1.txt dir/
$ mycli mv -f a.txt b.txt c.txt output/
```

---

## Composing a Command Tree

Commands compose into trees. A parent command has no handler — it contains sub-commands:

```ts
// src/commands/users/create.ts
import create from "./create";
import remove from "./remove";

export default zargv.command({
  description: "Manage users",
  commands: { create, remove }, // ← sub-commands
});

// src/cli.ts — entry point
import users from "./commands/users";

zargv({
  name: "mycli",
  description: "My application CLI",
  commands: { users },
}).run(process.argv);
```

Result :

```bash
$ mycli --help
My application CLI

Commands:
  users   Manage users [command]

$ mycli users create --name Bob
Creating user Bob (admin=false)
```

---

## External Handlers with `HandlerCtx`

To separate command definitions from their logic, use the helper type `HandlerCtx`:

```ts
import { z } from "zod";
import { zargv, HandlerCtx } from "zargv";

// 1. Define args and positionals separately
const mvArgs = zargv.from(
  z.object({ force: z.boolean().default(false) }),
  { aliases: { force: "f" } },
);

const mvPositionals = zargv.positionals.splitLast([
  ["sources",   z.array(z.string()).min(1)],
  ["directory", z.string()],
]);

// 2. Build the command with an inline handler that delegates
export default zargv.command({
  description: "Move files",
  args: mvArgs,
  positionals: mvPositionals,
  async handler(ctx) { await handleMove(ctx); },
});

// 3. Infer the full context type
type MvCtx = HandlerCtx<typeof import("./mv").default>;

// 4. Write logic separately — automatically typed
async function handleMove({ args, positionals }: MvCtx) {
  console.log(args.force, positionals.sources, positionals.directory);
}
```

---

## API Reference

### `zargv.from(schema, options?)`

Converts a Zod schema into an options definition for `zargv.command()`.

| Parameter | Description |
|-----------|-------------|
| `schema` | A `ZodObject`, e.g. `z.object({ name: z.string() })` |
| `options.aliases` | Optional map: canonical key → short flag character |

### `zargv.command(options)`

Builds a command node (leaf or parent).

| Parameter | Description |
|-----------|-------------|
| `description` | Short description, displayed in help |
| `args` | Options definition from `zargv.from()` (optional) |
| `positionals` | Positional arguments definition (optional) |
| `commands` | Nested sub-commands (optional) |
| `handler(ctx)` | Function receiving `{ args, positionals }` |

### `zargv.positionals.single(tuple)`

Command with exactly **one** operand.

```ts
zargv.positionals.single(["destination", z.string()]);
```

### `zargv.positionals.splitLast(tuple)`

`SOURCE... DEST` pattern — all operands except the last form a group, the last one is separate.

```ts
zargv.positionals.splitLast([
  ["sources",   z.array(z.string()).min(1)],
  ["directory", z.string()],
]);
```

### `zargv(options).run(argv)`

Creates and runs a CLI application.

| Parameter | Description |
|-----------|-------------|
| `name` | Binary name (displayed in help) |
| `description` | Root-level description |
| `commands` | Command tree |