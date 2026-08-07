# zargv

A **type-safe CLI framework** powered by [Zod](https://zod.dev). Define your command tree once, validate everything through schemas you already trust, and keep handler types inferred end-to-end.

## Table des matières

1. [Installation](#installation)
2. [Premier exemple : une commande sans arguments](#premier-exemple-une-commande-sans-arguments)
3. [Ajouter des options avec `--flag <value>`](#ajouter-des-options-avec---flag-value)
4. [Drapeaux booléens (`--verbose`)](#drapeaux-booléens----verbose)
5. [Valeurs par défaut](#valeurs-par-défaut)
6. [Arguments positionnels : un seul operand](#arguments-positionnels-un-seul-operand)
7. [Arguments positionnels : plusieurs operands](#arguments-positionnels-plusieurs-operands)
8. [Composer une arborescence de commandes](#composer-une-arborescence-de-commandes)
9. [Handlers externes avec `HandlerCtx`](#handlers-externes-avec-handlerctx)
10. [Référence API](#référence-api)

---

## Installation

```bash
npm install zargv zod
```

---

## Premier exemple : une commande sans arguments

La forme la plus simple — une commande qui fait quelque chose, sans aucun argument :

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

## Ajouter des options avec `--flag <value>`

Pour accepter des arguments nommés, on utilise `zargv.from()` qui convertit un schéma Zod en définition d'options :

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
    // TypeScript connaît : args.name est string
    console.log(`Hello, ${args.name}!`);
  },
});
```

Usage :

```bash
$ mycli greet --name Alice
Hello, Alice!
```

Les alias raccourcis sont optionnels :

```ts
zargv.from(
  z.object({ name: z.string() }),
  { aliases: { name: "n" } }, // maintenant -n et --name fonctionnent tous les deux
);
```

---

## Drapeaux booléens (`--verbose`)

Les booléens agissent comme des drapeaux : la présence du flag active la valeur, son absence la désactive.

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

## Valeurs par défaut

Quand une option a une valeur par défaut, elle devient facultative — le flag n'apparaît pas dans la signature d'utilisation.

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

## Arguments positionnels : un seul operand

Pour les commandes qui acceptent exactement **un** argument positionnel, utilisez `zargv.positionals.single()` :

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
    // TypeScript connaît : positionals.destination est string
    console.log(`Staging to ${positionals.destination}`);
  },
});
```

Usage :

```bash
$ mycli stage dist/       # → Staging to dist/
$ mycli stage             # → Erreur : exactement un operand requis
$ mycli stage a b         # → Erreur : trop d'operands
```

---

## Arguments positionnels : plusieurs operands

Pour les commandes avec **plusieurs** arguments positionnels, utilisez `zargv.positionals.splitLast()` — il sépare tous les operands sauf le dernier en un groupe, et le dernier reste seul. C'est le pattern classique de `cp SOURCE... DEST` ou `mv SOURCE... DIR` :

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

## Composer une arborescence de commandes

Les commandes se composent en arbres. Une commande parente n'a pas de handler — elle contient des sous-commandes :

```ts
// src/commands/users/create.ts
import create from "./create";
import remove from "./remove";

export default zargv.command({
  description: "Manage users",
  commands: { create, remove }, // ← sous-commandes
});

// src/cli.ts — point d'entrée
import users from "./commands/users";

zargv({
  name: "mycli",
  description: "My application CLI",
  commands: { users },
}).run(process.argv);
```

Résultat :

```bash
$ mycli --help
My application CLI

Commands:
  users   Manage users [command]

$ mycli users create --name Bob
Creating user Bob (admin=false)
```

---

## Handlers externes avec `HandlerCtx`

Pour séparer la définition des commandes de leur logique, utilisez le type helper `HandlerCtx` :

```ts
import { z } from "zod";
import { zargv, HandlerCtx } from "zargv";

// 1. Définir les args et positionnels séparément
const mvArgs = zargv.from(
  z.object({ force: z.boolean().default(false) }),
  { aliases: { force: "f" } },
);

const mvPositionals = zargv.positionals.splitLast([
  ["sources",   z.array(z.string()).min(1)],
  ["directory", z.string()],
]);

// 2. Construire la commande avec un handler inline qui délègue
export default zargv.command({
  description: "Move files",
  args: mvArgs,
  positionals: mvPositionals,
  async handler(ctx) { await handleMove(ctx); },
});

// 3. Inférer le type complet du contexte
type MvCtx = HandlerCtx<typeof import("./mv").default>;

// 4. Écrire la logique séparément — typée automatiquement
async function handleMove({ args, positionals }: MvCtx) {
  console.log(args.force, positionals.sources, positionals.directory);
}
```

---

## Référence API

### `zargv.from(schema, options?)`

Convertit un schéma Zod en définition d'options pour `zargv.command()`.

| Paramètre | Description |
|-----------|-------------|
| `schema` | Un `ZodObject`, ex. `z.object({ name: z.string() })` |
| `options.aliases` | Map optionnel : clé canonique → caractère de flag raccourci |

### `zargv.command(options)`

Construit un nœud de commande (feuille ou parente).

| Paramètre | Description |
|-----------|-------------|
| `description` | Description courte, affichée dans l'aide |
| `args` | Définition d'options depuis `zargv.from()` (optionnel) |
| `positionals` | Définition de positionnels (optionnel) |
| `commands` | Sous-commandes imbriquées (optionnel) |
| `handler(ctx)` | Fonction recevant `{ args, positionals }` |

### `zargv.positionals.single(tuple)`

Commande avec exactement **un** operand.

```ts
zargv.positionals.single(["destination", z.string()]);
```

### `zargv.positionals.splitLast(tuple)`

Pattern `SOURCE... DEST` — tous les operands sauf le dernier forment un groupe, le dernier est seul.

```ts
zargv.positionals.splitLast([
  ["sources",   z.array(z.string()).min(1)],
  ["directory", z.string()],
]);
```

### `zargv(options).run(argv)`

Crée et exécute une application CLI.

| Paramètre | Description |
|-----------|-------------|
| `name` | Nom du binaire (affiché dans l'aide) |
| `description` | Description de niveau racine |
| `commands` | Arborescence des commandes |