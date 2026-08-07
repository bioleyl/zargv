import type { CommandNode, LeafCommand } from "./types.js";
import { formatDefaultValue, wrapText } from "./format.js";

type OptionKind = "string" | "number" | "boolean";

interface CommandSummaryEntry {
    name: string;
    desc?: string;
}

interface HelpArgsDefMeta {
    _describeMap?: Map<string, string | undefined>;
    _parseArgsConfig?: Record<string, ParseOptionConfig>;
    _aliases?: Record<string, string>;
    _optionalMap?: Map<string, boolean>;
    _defaultMap?: Map<string, unknown>;
}

interface HelpPositionalsDefMeta {
    _usage: string;
}

interface LeafHelpRenderOptions {
    usagePrefix?: string;
}

function buildLeafUsageParts(
    leaf: LeafCommand<unknown>,
    options?: LeafHelpRenderOptions,
): string[] {
    const positionalsDef = leaf.positionalsDef as HelpPositionalsDefMeta | undefined;
    const ad = leaf.argsDef as HelpArgsDefMeta | undefined;
    const hasOptions = Boolean(ad?._describeMap && ad?._parseArgsConfig);

    return [
        options?.usagePrefix ?? "",
        hasOptions ? "[OPTIONS]" : "",
        positionalsDef?._usage ?? "",
    ].filter(Boolean);
}

export function buildLeafUsage(
    leaf: LeafCommand<unknown>,
    options?: LeafHelpRenderOptions,
): string | null {
    const usageParts = buildLeafUsageParts(leaf, options);
    return usageParts.length > 0 ? usageParts.join(" ") : null;
}

interface ParseOptionConfig {
    type?: string;
    kind?: string;
    choices?: readonly (string | number)[];
}

interface OptionRenderParts {
    shortWithComma: string;
    longLabel: string;
    description?: string;
}

function formatOptionTypeLabel(
    key: string,
    kind: OptionKind,
    choices?: readonly (string | number)[],
): string {
    const longFlag = `--${key}`;
    const typeLabel = choices?.length
        ? `[${choices.join(" | ")}]`
        : kind === "boolean"
            ? ""
            : `<${kind}>`;

    return typeLabel ? `${longFlag} ${typeLabel}` : longFlag;
}

function hasOptionalHint(text: string): boolean {
    return /\boptional\b/i.test(text);
}

function hasDefaultHint(text: string): boolean {
    return /\bdefault\b\s*:/i.test(text);
}

function renderLeafOptionLine(flagLabel: string, description: string | undefined, flagColWidth: number): string {
    const leftPad = "  ";
    const descGap = "  ";
    const prefix = `${leftPad}${flagLabel.padEnd(flagColWidth)}${descGap}`;

    if (!description) return `${leftPad}${flagLabel}`;

    const terminalWidth = 80;
    const descWidth = Math.max(20, terminalWidth - prefix.length);
    const wrapped = wrapText(description, descWidth);
    const continuation = " ".repeat(prefix.length);

    return wrapped
        .map((line, index) => (index === 0 ? `${prefix}${line}` : `${continuation}${line}`))
        .join("\n");
}

function splitCommandSummaries(
    commands: Record<string, CommandNode>,
): { leaves: CommandSummaryEntry[]; parents: CommandSummaryEntry[] } {
    const leaves: CommandSummaryEntry[] = [];
    const parents: CommandSummaryEntry[] = [];

    for (const [name, node] of Object.entries(commands)) {
        (node.__brand__ === "leaf" ? leaves : parents).push({ name, desc: node.description });
    }

    return { leaves, parents };
}

function appendCommandSummaryLines(
    lines: string[],
    leaves: CommandSummaryEntry[],
    parents: CommandSummaryEntry[],
): void {
    lines.push("Commands:");

    const allNames = [...leaves, ...parents];
    const maxNameLen = Math.max(...allNames.map((n) => n.name.length));

    for (const leaf of leaves) {
        const padded = leaf.name.padEnd(maxNameLen + 2);
        lines.push(`  ${padded}${leaf.desc ?? ""}`);
    }

    for (const parent of parents) {
        const padded = parent.name.padEnd(maxNameLen + 2);
        lines.push(`  ${padded}${parent.desc ?? ""} [command]`);
    }
}

function toOptionKind(optConfig: ParseOptionConfig): OptionKind {
    if (optConfig.type === "boolean") return "boolean";
    if (optConfig.kind === "number") return "number";
    return "string";
}

function buildOptionDescription(
    key: string,
    describeText: string | undefined,
    optionalMap?: Map<string, boolean>,
    defaultMap?: Map<string, unknown>,
): string | undefined {
    const baseDesc = describeText ?? "";
    const defaultValue = defaultMap?.get(key);
    const noteParts = [
        optionalMap?.get(key) && !hasOptionalHint(baseDesc) ? "optional" : "",
        defaultMap?.has(key) && !hasDefaultHint(baseDesc)
            ? `default: ${formatDefaultValue(defaultValue)}`
            : "",
    ].filter(Boolean) as string[];

    const noteSuffix = noteParts.length > 0 ? ` (${noteParts.join(", ")})` : "";
    const fullDesc = `${baseDesc}${noteSuffix}`.trim();
    return fullDesc || undefined;
}

export function generateHelp(
    commands: Record<string, CommandNode>,
    description?: string,
): string {
    const lines: string[] = [];

    if (description) {
        lines.push(description);
        lines.push("");
    }

    const { leaves, parents } = splitCommandSummaries(commands);
    const hasChildren = leaves.length > 0 || parents.length > 0;

    if (!hasChildren && !description) return "";
    if (!hasChildren) return lines.join("\n");

    appendCommandSummaryLines(lines, leaves, parents);
    return lines.join("\n");
}

export function generateLeafHelp(
    leaf: LeafCommand<unknown>,
    options?: LeafHelpRenderOptions,
): string | null {
    const positionalsDef = leaf.positionalsDef as HelpPositionalsDefMeta | undefined;
    if (!leaf.argsDef && !positionalsDef) return null;

    const ad = leaf.argsDef as HelpArgsDefMeta | undefined;
    const describeMap = ad?._describeMap;
    const parseConfig = ad?._parseArgsConfig;
    const aliases = ad?._aliases;
    const optionalMap = ad?._optionalMap;
    const defaultMap = ad?._defaultMap;

    const hasOptions = Boolean(describeMap && parseConfig);

    const lines: string[] = [];
    lines.push(leaf.description ?? "Usage");
    lines.push("");

    const usageParts = buildLeafUsageParts(leaf, options);

    if (usageParts.length > 0) {
        lines.push(`Usage: ${usageParts.join(" ")}`);
        if (hasOptions) lines.push("");
    }

    if (!hasOptions || !describeMap || !parseConfig) return lines.join("\n");

    lines.push("Options:");

    const optionLines: OptionRenderParts[] = [];

    for (const [key, describeText] of describeMap.entries()) {
        const optConfig = parseConfig[key];
        if (!optConfig) continue;

        const kind = toOptionKind(optConfig);
        const longLabel = formatOptionTypeLabel(key, kind, optConfig.choices);
        const shortWithComma = aliases?.[key] ? `-${aliases[key]}, ` : "";
        const description = buildOptionDescription(key, describeText, optionalMap, defaultMap);

        optionLines.push({ shortWithComma, longLabel, description });
    }

    const aliasGutterWidth = optionLines.reduce(
        (max, line) => (line.shortWithComma.length > max ? line.shortWithComma.length : max),
        0,
    );

    const renderedLabels = optionLines.map((line) => {
        const shortCol = line.shortWithComma.padEnd(aliasGutterWidth);
        return `${shortCol}${line.longLabel}`;
    });

    const flagColWidth = renderedLabels.reduce((max, label) => Math.max(max, label.length), 0);

    for (const [index, line] of optionLines.entries()) {
        lines.push(renderLeafOptionLine(renderedLabels[index], line.description, flagColWidth));
    }

    return lines.join("\n");
}

export function isHelpFlag(token: string): boolean {
    return token === "--help" || token === "-h";
}

export function printHelp(name: string, description: string, commands: Record<string, CommandNode>): void {
    const lines: string[] = [];
    lines.push(description || `Usage: ${name} <command> [options]`);
    lines.push("");

    const { leaves, parents } = splitCommandSummaries(commands);
    const hasChildren = leaves.length > 0 || parents.length > 0;

    if (!hasChildren) {
        console.log(lines.join("\n"));
        return;
    }

    appendCommandSummaryLines(lines, leaves, parents);
    console.log(lines.join("\n"));
}

export function printCommandHelp(
    pathSegments: string[],
    commands: Record<string, CommandNode>,
): void {
    let current = commands;
    let description: string | undefined;

    for (const seg of pathSegments) {
        if (!Object.hasOwn(current, seg)) return;

        const node = current[seg];

        description = node.description;
        if (node.__brand__ === "leaf") break;
        current = node.commands;
    }

    console.log(generateHelp(current, description));
}