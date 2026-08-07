import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zargv } from "../src/index.js";
import type { ZargvOptions } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  name: z.string().describe("User name"),
  admin: z.boolean()
    .default(false)
    .describe("Create as administrator"),
});

const deleteUserSchema = z.object({
  id: z.string().describe("User ID to delete"),
});

function makeCLI(commands: Record<string, any>): ZargvOptions {
  return { name: "mycli", description: "My application CLI", commands };
}

// ---------------------------------------------------------------------------
// Test groups.
// ---------------------------------------------------------------------------

describe("zargv.from() — alias mapping", () => {
  it("aliases do not leak into handler args", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema, { aliases: { name: "n" } }),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    const origArgv = process.argv;
    process.argv = ["node", "test", "create", "-n", "Bob"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedArgs).toEqual({ name: "Bob", admin: false });
    // Verify alias key does NOT appear.
    expect("n" in capturedArgs).toBe(false);
  });

  it("--long flag works with aliases", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema, { aliases: { name: "n" } }),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    const origArgv = process.argv;
    process.argv = ["node", "test", "create", "--name", "Alice"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedArgs).toEqual({ name: "Alice", admin: false });
  });
});

describe("zargv.from() — defaults", () => {
  it("applies default values when flag is omitted", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    const origArgv = process.argv;
    process.argv = ["node", "test", "create", "--name", "Bob"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedArgs).toEqual({ name: "Bob", admin: false });
  });

  it("overrides defaults when flag is provided", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    const origArgv = process.argv;
    process.argv = ["node", "test", "create", "--name", "Bob", "--admin"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedArgs).toEqual({ name: "Bob", admin: true });
  });
});

describe("zargv.from() — required fields", () => {
  it("Zod validation error when required field is missing", async () => {
    const cli = zargv(makeCLI({
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema),
        handler() { },
      }),
    }));

    const origArgv = process.argv;
    // No --name provided — should fail validation.
    process.argv = ["node", "test", "create"];

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(process.argv);
    } catch (err: unknown) {
      // Expected — process.exit mock throws to stop execution.
      if (!(err instanceof Error && String(err).startsWith("Error: exit:"))) throw err;
    } finally {
      console.log = (() => { }) as any; // suppress error output.
      process.exit = origExit;
      process.argv = origArgv;
    }

    expect(exitCode).toBe(1);
  });
});

describe("zargv.from() — schema reuse", () => {
  it("schema can be parsed independently of CLI", async () => {
    // Parse directly with Zod — no CLI involvement.
    const result = createUserSchema.parse({ name: "Bob" });
    expect(result).toEqual({ name: "Bob", admin: false });

    // With transform / refinement would also work here.
  });

  it("schema rejects invalid data outside CLI context", () => {
    expect(() => createUserSchema.parse({})).toThrow(z.ZodError);
  });
});

describe("command definition validation", () => {
  it("throws when a leaf command has no handler", () => {
    expect(() => zargv.command({ description: "Invalid leaf" })).toThrow("Leaf command requires a handler");
  });

  it("throws when a parent command defines a handler", () => {
    expect(() => zargv.command({
      description: "Invalid parent",
      commands: {
        child: zargv.command({
          description: "Child",
          handler() { },
        }),
      },
      handler() { },
    })).toThrow("Parent command cannot define a handler");
  });
});

describe("nested commands — routing", () => {
  const usersCommands: Record<string, any> = zargv.command({
    description: "Manage users",
    commands: {
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema),
        handler(ctx) { },
      }),
      delete: zargv.command({
        description: "Delete a user",
        args: zargv.from(deleteUserSchema),
        handler() { },
      }),
    },
  });

  it("routes to nested leaf command", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      users: usersCommands,
    }));

    // Patch the create handler.
    (usersCommands.commands.create as any).handler = (ctx: any) => {
      capturedArgs = ctx.args;
    };

    const origArgv = process.argv;
    process.argv = ["node", "test", "users", "create", "--name", "Bob"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedArgs).toEqual({ name: "Bob", admin: false });
  });

  it("routes to another nested leaf command", async () => {
    let capturedId: string | undefined;

    const cli = zargv(makeCLI({
      users: usersCommands,
    }));

    (usersCommands.commands.delete as any).handler = (ctx: any) => {
      capturedId = ctx.args.id;
    };

    const origArgv = process.argv;
    process.argv = ["node", "test", "users", "delete", "--id", "42"];

    try {
      await cli.run(process.argv);
    } finally {
      process.argv = origArgv;
    }

    expect(capturedId).toBe("42");
  });

  it("errors on unknown command path", async () => {
    const cli = zargv(makeCLI({ users: usersCommands }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    const origArgv = process.argv;
    process.argv = ["node", "test", "unknown"];

    let stderrOutput = "";
    const origError = console.error;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    try {
      await cli.run(process.argv);
    } catch (err: unknown) {
      // Expected — process.exit mock throws to stop execution.
      if (!(err instanceof Error && String(err).startsWith("Error: exit:"))) throw err;
    } finally {
      process.exit = origExit;
      console.error = origError;
      process.argv = origArgv;
    }

    expect(exitCode).toBe(1);
  });
});

describe("help generation", () => {
  it("--help at root shows commands list", async () => {
    const cli = zargv(makeCLI({ users: usersCommands() }));

    let stdoutOutput = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { stdoutOutput += args.join(" ") + "\n"; };

    const origArgv = process.argv;
    process.argv = ["node", "test", "--help"];

    try {
      await cli.run(process.argv);
    } finally {
      console.log = origLog;
      process.argv = origArgv;
    }

    expect(stdoutOutput).toContain("Manage users");
  });

  it("-h at root is equivalent to --help", async () => {
    const cli = zargv(makeCLI({ users: usersCommands() }));

    let stdoutOutput = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { stdoutOutput += args.join(" ") + "\n"; };

    const origArgv = process.argv;
    process.argv = ["node", "test", "-h"];

    try {
      await cli.run(process.argv);
    } finally {
      console.log = origLog;
      process.argv = origArgv;
    }

    expect(stdoutOutput).toContain("Manage users");
  });

  it("--help on leaf shows options from schema describe()", async () => {
    const createCmd = zargv.command({
      description: "Create a user",
      args: zargv.from(createUserSchema, { aliases: { name: "n" } }),
      handler() { },
    });

    const cli = zargv(makeCLI({ users: usersCommands(), create: createCmd }));

    let stdoutOutput = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { stdoutOutput += args.join(" ") + "\n"; };

    const origArgv = process.argv;
    // Request help on the leaf command specifically.
    process.argv = ["node", "test", "create", "--help"];

    try {
      await cli.run(process.argv);
    } finally {
      console.log = origLog;
      process.argv = origArgv;
    }

    expect(stdoutOutput).toContain("User name");
    expect(stdoutOutput).toContain("Create as administrator (optional,");
    expect(stdoutOutput).toContain("default:");
    expect(stdoutOutput).toContain("false)");
  });
});

// Helper to recreate usersCommands fresh for each test.
function usersCommands(): Record<string, any> {
  return zargv.command({
    description: "Manage users",
    commands: {
      create: zargv.command({
        description: "Create a user",
        args: zargv.from(createUserSchema),
        handler() { },
      }),
      delete: zargv.command({
        description: "Delete a user",
        args: zargv.from(deleteUserSchema),
        handler() { },
      }),
    },
  });
}
