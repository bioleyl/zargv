#!/usr/bin/env node
/**
 * zargv Demo — a sample CLI built with zargv.
 * Run it locally: npx tsx examples/demo.ts <command> [options]
 */

import { z } from "zod";
import { zargv } from "../src/index.js";
import type { HandlerCtx } from "../src/index.js";

// ---------------------------------------------------------------------------
// Schemas (the single source of truth — reusable anywhere)
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  name: z.string().describe("User display name"),
  email: z.string().email().optional().describe("Email address (optional)"),
  admin: z.boolean()
    .default(false)
    .describe("Grant administrator privileges"),
});

type CreateUserArgs = z.infer<typeof createUserSchema>;

const deleteUserSchema = z.object({
  id: z.string().describe("User ID to delete"),
});

const listUsersSchema = z.object({
  role: z.enum(["admin", "user", "guest"]).default("user").describe("Filter by role"),
  limit: z.coerce.number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe("Max results to return (1–100)"),
});

const updateProfileSchema = z.object({
  id: z.string().describe("User ID"),
  name: z.string().optional().describe("New display name"),
  status: z.enum(["active", "inactive"]).default("active").describe("Account status"),
  tags: z.array(z.string()).optional().default([]).describe("Tags to assign (repeatable)"),
});

const moveArgs = zargv.from(z.object({
  force: z.boolean().default(false).describe("Overwrite destination files"),
}), { aliases: { force: "f" } });

const movePositionals = zargv.positionals.splitLast([
  ["sources", z.array(z.string()).min(1)],
  ["directory", z.string()],
]);

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const createCmd = zargv.command({
  description: "Create a new user",

  args: zargv.from(createUserSchema, { aliases: { name: "n" } }),

  async handler({ args }) {
    console.log(`✅ Created user "${args.name}" (admin=${args.admin})`);
    if (args.email) console.log(`   Email: ${args.email}`);
  },
});

const deleteCmd = zargv.command({
  description: "Delete a user by ID",

  args: zargv.from(deleteUserSchema, { aliases: { id: "i" } }),

  async handler({ args }) {
    console.log(`🗑️  Deleted user "${args.id}"`);
  },
});

const listCmd = zargv.command({
  description: "List users with optional filters",

  args: zargv.from(listUsersSchema, { aliases: { role: "r" } }),

  async handler({ args }) {
    console.log(`📋 Listing ${args.limit} user(s) with role="${args.role}"`);
  },
});

const updateCmd = zargv.command({
  description: "Update a user profile",

  args: zargv.from(updateProfileSchema, { aliases: { id: "i" } }),

  async handler({ args }) {
    console.log(`✏️  Updated user "${args.id}"`);
    if (args.name) console.log(`   Name → ${args.name}`);
    console.log(`   Status → ${args.status}`);
    if (args.tags.length > 0) console.log(`   Tags: [${args.tags.join(", ")}]`);
  },
});

const moveCmd = zargv.command({
  description: "Move files (mv-style SOURCE... DIRECTORY)",

  args: moveArgs,
  positionals: movePositionals,
  handler(ctx) {
    handleMove(ctx);
  },
});

type MoveCtx = HandlerCtx<typeof moveCmd>;

function handleMove({ args, positionals }: MoveCtx) {
  console.log(`📦 Moving ${positionals.sources.length} file(s) to "${positionals.directory}"`);
  if (args.force) console.log("   Force overwrite enabled.");
  for (const source of positionals.sources) {
    console.log(`   ${source} -> ${positionals.directory}`);
  }
}

const stageCmd = zargv.command({
  description: "Stage to DESTINATION (exactly one argument)",

  positionals: zargv.positionals.single(["destination", z.string()]),

  handler({ positionals }) {
    console.log(`🧺 Destination-only mode: "${positionals.destination}"`);
  },
});

// ---------------------------------------------------------------------------
// Parent commands
// ---------------------------------------------------------------------------

const usersCmd = zargv.command({
  description: "Manage user accounts",
  commands: { create: createCmd, delete: deleteCmd, list: listCmd, update: updateCmd },
});

const configCmd = zargv.command({
  description: "Configure application settings",
  args: zargv.from(z.object({ verbose: z.boolean().default(false) })),
  handler({ args }) {
    if (args.verbose) console.log("Verbose mode enabled.");
    console.log("Configuration saved.");
  },
});

// ---------------------------------------------------------------------------
// Root CLI
// ---------------------------------------------------------------------------

zargv({
  name: "democli",
  description: "A demo CLI built with zargv — showcasing all features.",

  commands: { users: usersCmd, config: configCmd, mv: moveCmd, stage: stageCmd },
}).run(process.argv);
