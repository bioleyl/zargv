import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zargv } from "../src/index.js";

function makeCLI(commands: Record<string, any>) {
  return { name: "mycli", description: "", commands };
}

describe("enums — help output and validation", () => {
  it("--help shows available enum values in brackets", async () => {
    const schema = z.object({ status: z.enum(["active", "inactive"]).default("active") });

    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await zargv(makeCLI({
        cmd: zargv.command({ description: "Set status", args: zargv.from(schema), handler() {} }),
      })).run(["node", "test", "cmd", "--help"]);
    } finally {
      const origLog = (() => {}) as any;
      console.log = origLog;
    }

    // Should show enum values, not a generic <string> placeholder.
    expect(stdoutOutput).toContain("[active | inactive]");
  });

  it("--help shows enum with alias", async () => {
    const schema = z.object({ status: z.enum(["on", "off"]) });

    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await zargv(makeCLI({
        cmd: zargv.command({ description: "", args: zargv.from(schema, { aliases: { status: "s" } }), handler() {} }),
      })).run(["node", "test", "cmd", "--help"]);
    } finally {
      const origLog = (() => {}) as any;
      console.log = origLog;
    }

    expect(stdoutOutput).toContain("[on | off]");
  });

  it("invalid enum value shows clear error with valid choices", async () => {
    let exitCode: number | undefined;
    let stderrOutput = "";

    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;
    console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };

    try {
      await zargv(makeCLI({
        cmd: zargv.command({ description: "", args: zargv.from(z.object({ status: z.enum(["active", "inactive"]) })), handler() {} }),
      })).run(["node", "test", "cmd", "--status", "unknown"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => {}) as any;
      console.error = (() => {}) as any;
    }

    expect(exitCode).toBe(1);
    // Should show the valid choices in the error message.
    expect(stderrOutput.toLowerCase()).toContain("expected one of");
  });

  it("valid enum value is accepted", async () => {
    let capturedArgs: any;

    const cli = zargv(makeCLI({
      cmd: zargv.command({ description: "", args: zargv.from(z.object({ status: z.enum(["active", "inactive"]) })), handler(ctx) { capturedArgs = ctx.args; } }),
    }));

    let exitCode: number | undefined;
    (process.exit as any) = ((code?: number) => { exitCode = code ?? 1; throw new Error(`exit:${code}`); }) as never;

    try {
      await cli.run(["node", "test", "cmd", "--status", "inactive"]);
    } catch (e: unknown) {
      if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
    } finally {
      process.exit = (() => {}) as any;
    }

    expect(capturedArgs.status).toBe("inactive");
  });
});
