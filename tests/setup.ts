import { z } from "zod";
import { zargv, type ZargvOptions } from "../src/index.js";

// ---------------------------------------------------------------------------
// Test fixtures — reusable schemas and command trees.
// ---------------------------------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().describe("User name"),
  admin: z.boolean()
    .default(false)
    .describe("Create as administrator"),
});

export type CreateUserArgs = z.infer<typeof createUserSchema>;

export const deleteUserSchema = z.object({
  id: z.string().describe("User ID to delete"),
});

// ---------------------------------------------------------------------------
// Helper — capture console output.
// ---------------------------------------------------------------------------

function createCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const origLog = console.log;
  const origError = console.error;

  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));

  return {
    get stdout() {
      return stdout.join("\n");
    },
    get stderr() {
      return stderr.join("\n");
    },
    restore() {
      console.log = origLog;
      console.error = origError;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper — build a test CLI and run it with given argv.
// ---------------------------------------------------------------------------

interface TestResult<T> {
  stdout: string;
  stderr: string;
  args: T | undefined;
  handlerCalled: boolean;
}

async function runTestCLI<T>(
  options: ZargvOptions,
  argvParts: string[],
): Promise<TestResult<T>> {
  const capture = createCapture();

  let capturedArgs: T | undefined;
  let handlerCalled = false;

  // Wrap commands to intercept the handler.
  function wrapCommands(commands: Record<string, any>): Record<string, any> {
    const wrapped: Record<string, any> = {};
    for (const [name, node] of Object.entries(commands)) {
      if (node.__brand__ === "leaf" && typeof node.handler === "function") {
        const origHandler = node.handler;
        wrapped[name] = {
          ...node,
          handler: async (ctx: any) => {
            capturedArgs = ctx.args as T;
            handlerCalled = true;
            await origHandler(ctx);
          },
        };
      } else if (node.__brand__ === "parent") {
        wrapped[name] = { ...node, commands: wrapCommands(node.commands) };
      } else {
        wrapped[name] = node;
      }
    }
    return wrapped;
  }

  const wrappedCommands = wrapCommands(options.commands);
  const cli = zargv({ ...options, commands: wrappedCommands });

  // Replace process.argv for the duration.
  const origArgv = process.argv;
  process.argv = ["node", "test-script", ...argvParts];

  try {
    await cli.run(process.argv);
  } finally {
    capture.restore();
    process.argv = origArgv;
  }

  return {
    stdout: capture.stdout,
    stderr: capture.stderr,
    args: capturedArgs,
    handlerCalled,
  };
}

export { createCapture, runTestCLI };
