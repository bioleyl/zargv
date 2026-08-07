import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zargv } from "../src/index.js";

function makeCLI(commands: Record<string, any>) {
    return { name: "mycli", description: "My CLI", commands };
}

describe("positionals.splitLast", () => {
    it("parses rest+last operands into typed keys", async () => {
        let capturedPositionals: unknown;

        const cli = zargv(makeCLI({
            mv: zargv.command({
                description: "Move files",
                positionals: zargv.positionals.splitLast([
                    ["sources", z.array(z.string()).min(1)],
                    ["directory", z.string()],
                ]),
                handler({ positionals }) {
                    capturedPositionals = positionals;
                },
            }),
        }));

        await cli.run(["node", "test", "mv", "a.txt", "b.txt", "dist/"]);

        expect(capturedPositionals).toEqual({
            sources: ["a.txt", "b.txt"],
            directory: "dist/",
        });
    });

    it("supports flags and splitLast operands together", async () => {
        let captured: unknown;

        const cli = zargv(makeCLI({
            mv: zargv.command({
                description: "Move files",
                args: zargv.from(z.object({ force: z.boolean().default(false) }), { aliases: { force: "f" } }),
                positionals: zargv.positionals.splitLast([
                    ["sources", z.array(z.string()).min(1)],
                    ["directory", z.string()],
                ]),
                handler({ args, positionals }) {
                    captured = { args, positionals };
                },
            }),
        }));

        await cli.run(["node", "test", "mv", "--force", "a.txt", "dist/"]);

        expect(captured).toEqual({
            args: { force: true },
            positionals: { sources: ["a.txt"], directory: "dist/" },
        });
    });

    it("fails validation when final operand is missing", async () => {
        let exitCode: number | undefined;
        let stderrOutput = "";

        (process.exit as any) = ((code?: number) => {
            exitCode = code ?? 1;
            throw new Error(`exit:${code}`);
        }) as never;
        console.error = (...args) => { stderrOutput += args.join(" "); };

        const cli = zargv(makeCLI({
            mv: zargv.command({
                description: "Move files",
                positionals: zargv.positionals.splitLast([
                    ["sources", z.array(z.string()).min(1)],
                    ["directory", z.string()],
                ]),
                handler() { },
            }),
        }));

        try {
            await cli.run(["node", "test", "mv"]);
        } catch (e: unknown) {
            if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
        } finally {
            process.exit = (() => { }) as any;
            console.error = (() => { }) as any;
        }

        expect(exitCode).toBe(1);
        expect(stderrOutput).toContain("Missing required positional argument: directory");
    });

    it("shows splitLast usage in --help", async () => {
        let stdoutOutput = "";
        const origLog = console.log;
        console.log = (...args: unknown[]) => { stdoutOutput += args.join(" ") + "\n"; };

        const cli = zargv(makeCLI({
            mv: zargv.command({
                description: "Move files",
                positionals: zargv.positionals.splitLast([
                    ["sources", z.array(z.string()).min(1)],
                    ["directory", z.string()],
                ]),
                handler() { },
            }),
        }));

        try {
            await cli.run(["node", "test", "mv", "--help"]);
        } finally {
            console.log = origLog;
        }

        expect(stdoutOutput).toContain("Usage: test mv SOURCES... DIRECTORY");
    });
});

describe("positionals.single", () => {
    it("parses exactly one positional operand", async () => {
        let capturedPositionals: unknown;

        const cli = zargv(makeCLI({
            stage: zargv.command({
                description: "Stage destination",
                positionals: zargv.positionals.single(["destination", z.string()]),
                handler({ positionals }) {
                    capturedPositionals = positionals;
                },
            }),
        }));

        await cli.run(["node", "test", "stage", "dist/"]);
        expect(capturedPositionals).toEqual({ destination: "dist/" });
    });

    it("fails when more than one positional operand is provided", async () => {
        let exitCode: number | undefined;
        let stderrOutput = "";

        (process.exit as any) = ((code?: number) => {
            exitCode = code ?? 1;
            throw new Error(`exit:${code}`);
        }) as never;
        console.error = (...args) => { stderrOutput += args.join(" "); };

        const cli = zargv(makeCLI({
            stage: zargv.command({
                description: "Stage destination",
                positionals: zargv.positionals.single(["destination", z.string()]),
                handler() { },
            }),
        }));

        try {
            await cli.run(["node", "test", "stage", "dist/", "extra"]);
        } catch (e: unknown) {
            if (!(e instanceof Error && String(e).startsWith("Error: exit:"))) throw e;
        } finally {
            process.exit = (() => { }) as any;
            console.error = (() => { }) as any;
        }

        expect(exitCode).toBe(1);
        expect(stderrOutput).toContain("Too many positional arguments");
    });

    it("shows single positional usage in --help", async () => {
        let stdoutOutput = "";
        const origLog = console.log;
        console.log = (...args: unknown[]) => { stdoutOutput += args.join(" ") + "\n"; };

        const cli = zargv(makeCLI({
            stage: zargv.command({
                description: "Stage destination",
                positionals: zargv.positionals.single(["destination", z.string()]),
                handler() { },
            }),
        }));

        try {
            await cli.run(["node", "test", "stage", "--help"]);
        } finally {
            console.log = origLog;
        }

        expect(stdoutOutput).toContain("Usage: test stage DESTINATION");
    });
});
