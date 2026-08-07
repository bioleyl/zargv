import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zargv } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const addTagSchema = z.object({
  id: z.string().describe("Item ID"),
  tags: z.array(z.string()).optional().default([]).describe("Tags to add"),
});

const statusEnumSchema = z.object({
  status: z.enum(["active", "inactive"]).default("active").describe("New status"),
});

const countSchema = z.object({
  limit: z.coerce.number()
    .int()
    .positive()
    .default(10)
    .describe("Max items to return"),
});

function makeCLI(commands: Record<string, any>) {
  return { name: "mycli", description: "My CLI", commands };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("arrays", () => {
  it("parses multiple values into an array", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      add: zargv.command({
        description: "Add tags",
        args: zargv.from(addTagSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "add", "--id", "42", "--tags", "a", "--tags", "b"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.tags).toEqual(["a", "b"]);
  });

  it("uses default empty array when no tags provided", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      add: zargv.command({
        description: "Add tags",
        args: zargv.from(addTagSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "add", "--id", "42"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.tags).toEqual([]);
  });
});

describe("enums", () => {
  it("parses enum values correctly", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      set: zargv.command({
        description: "Set status",
        args: zargv.from(statusEnumSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "set", "--status", "inactive"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.status).toBe("inactive");
  });

  it("uses default enum value when not provided", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      set: zargv.command({
        description: "Set status",
        args: zargv.from(statusEnumSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "set"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.status).toBe("active");
  });
});

describe("number coercion", () => {
  it("coerces string to number via Zod coerce", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      list: zargv.command({
        description: "List items",
        args: zargv.from(countSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "list", "--limit", "25"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.limit).toBe(25);
    expect(typeof capturedArgs.limit).toBe("number");
  });

  it("uses default number when not provided", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      list: zargv.command({
        description: "List items",
        args: zargv.from(countSchema),
        handler(ctx) {
          capturedArgs = ctx.args;
        },
      }),
    }));

    let exitCode: number | undefined;
    const origExit = process.exit;
    (process.exit as any) = ((code?: number) => {
      exitCode = code ?? 1;
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await cli.run(["node", "test", "list"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = origExit;
    }

    expect(capturedArgs.limit).toBe(10);
  });
});

describe("help generation — leaf with options", () => {
  it("--help on a command shows schema describe() text and aliases", async () => {
    const cli = zargv(makeCLI({
      add: zargv.command({
        description: "Add tags to an item",
        args: zargv.from(addTagSchema, { aliases: { id: "i" } }),
        handler() { },
      }),
    }));

    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await cli.run(["node", "test", "add", "--help"]);
    } finally {
      const origLog = (() => { }) as any;
      console.log = origLog;
    }

    expect(stdoutOutput).toContain("Add tags to an item");
    expect(stdoutOutput).toContain("Item ID");
    expect(stdoutOutput).toContain("-i, --id <string>"); // alias for id.
    expect(stdoutOutput).toContain("--tags <string>"); // no-alias options keep flag/type spacing.
    expect(stdoutOutput).toContain("Tags to add (optional, default: [])");
  });
});

describe("Zod refinements", () => {
  it("validation errors from .refine() are shown after coercion", async () => {
    const schema = z.object({
      age: z.coerce.number().int().positive().refine(
        (v) => v <= 150,
        "Age must be at most 150",
      ),
    });

    let exitCode: number | undefined;
    let stderrOutput = "";

    const cli = zargv(makeCLI({
      profile: zargv.command({
        description: "Set user age",
        args: zargv.from(schema),
        handler() { },
      }),
    }));

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args) => { stderrOutput += args.join(" "); };

    try {
      await cli.run(["node", "test", "profile", "--age", "200"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    expect(stderrOutput).toContain("Age must be at most 150");
  });
});
