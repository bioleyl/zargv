import { describe, it, expect } from "vitest";
import { zargv } from "../src/index.js";

function makeCLI(commands: Record<string, any>) {
  return { name: "mycli", description: "", commands };
}

describe("help — parent-level --help mid-path", () => {
  it("--help on a parent command shows its subcommands", async () => {
    const createCmd = zargv.command({
      description: "Create something",
      handler() {},
    });

    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await zargv(makeCLI({ items: makeParent(), create: createCmd })).run([
        "node",
        "test",
        "items",
        "--help",
      ]);
    } finally {
      const origLog = (() => {}) as any;
      console.log = origLog;
    }

    expect(stdoutOutput).toContain("Create something");
  });

  it("-h on a parent command works too", async () => {
    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await zargv(makeCLI({ items: makeParent() })).run(["node", "test", "items", "-h"]);
    } finally {
      const origLog = (() => {}) as any;
      console.log = origLog;
    }

    expect(stdoutOutput).toContain("Create something");
  });

  it("--help at end of parent path shows subcommands (no leaf reached)", async () => {
    let stdoutOutput = "";
    console.log = (...args) => { stdoutOutput += args.join(" ") + "\n"; };

    try {
      await zargv(makeCLI({ items: makeParent() })).run(["node", "test", "items"]);
    } finally {
      const origLog = (() => {}) as any;
      console.log = origLog;
    }

    expect(stdoutOutput).toContain("Create something");
  });
});

function makeParent(): Record<string, any> {
  return zargv.command({
    description: "Manage items",
    commands: {
      create: zargv.command({
        description: "Create something",
        handler() {},
      }),
    },
  });
}
