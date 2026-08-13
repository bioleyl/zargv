import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zargv } from "../src/index.js";

function makeCLI(commands: Record<string, any>) {
  return { name: "mycli", description: "My CLI", commands };
}

describe("wrong parameters — error handling", () => {
  it("rejects unknown flags with a clear message", async () => {
    const schema = z.object({ name: z.string() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--namd", "Bob"]); // typo in flag name.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    // Should get a clear error about the unrecognized option.
    expect(stderrOutput.toLowerCase()).toContain("unrecognized");
  });

  it("rejects missing required fields", async () => {
    const schema = z.object({ name: z.string() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd"]); // no --name.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    // Zod should complain that the required field is undefined.
    expect(stderrOutput.toLowerCase()).toContain("received undefined");
  });

  it("rejects wrong value type without coercion", async () => {
    const schema = z.object({ count: z.number() }); // no coerce — parseArgs gives strings.

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--count", "not-a-number"]); // parseArgs gives string.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    // Zod should complain about receiving a string instead of number.
    expect(stderrOutput.toLowerCase()).toContain("expected");
  });

  it("rejects invalid enum values", async () => {
    const schema = z.object({ status: z.enum(["active", "inactive"]) });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--status", "unknown"]); // not in enum.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
  });

  it("rejects negative numbers when .positive() is used", async () => {
    const schema = z.object({ count: z.coerce.number().int().positive() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--count", "-5"]); // negative.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
  });

  it("rejects multiple unknown flags", async () => {
    const schema = z.object({ name: z.string() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--foo", "bar", "--baz"]); // two unknown flags.
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
  });

  it("rejects unexpected positional arguments", async () => {
    const schema = z.object({ name: z.string(), admin: z.boolean().default(false) });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "cmd", "--name", "Bob", "--admin", "extra"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    expect(stderrOutput.toLowerCase()).toContain("unexpected positional");
  });

  it("rejects prototype-chain command tokens at root (__proto__)", async () => {
    // Security fix: command lookup must only use own properties.
    // Without this, tokens like "__proto__" can resolve via Object prototype,
    // producing invalid nodes and crashing instead of returning a clean error.
    const schema = z.object({ name: z.string() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "A command", args: zargv.from(schema), handler() { } }),
    }));

    try {
      await cli.run(["node", "test", "__proto__"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    expect(stderrOutput.toLowerCase()).toContain("unknown command");
  });

  it("rejects prototype-chain command tokens on nested command paths", async () => {
    // Security fix: nested command traversal must also avoid prototype lookup.
    // This prevents crafted tokens (e.g. users __proto__) from bypassing checks
    // and triggering runtime TypeErrors (DoS).
    const schema = z.object({ name: z.string() });

    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    const cli = zargv(makeCLI({
      users: zargv.command({
        description: "Users commands",
        commands: {
          create: zargv.command({ description: "Create", args: zargv.from(schema), handler() { } }),
        },
      }),
    }));

    try {
      await cli.run(["node", "test", "users", "__proto__"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => { }) as any;
      console.error = (() => { }) as any;
    }

    expect(exitCode).toBe(1);
    expect(stderrOutput.toLowerCase()).toContain("unknown command");
  });
});
