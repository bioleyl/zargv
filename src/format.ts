export function formatDefaultValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function wrapText(text: string, width: number): string[] {
    if (text.length <= width) return [text];

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];

    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        if (current.length === 0) {
            current = word;
            continue;
        }

        if ((current.length + 1 + word.length) <= width) {
            current = `${current} ${word}`;
            continue;
        }

        lines.push(current);
        current = word;
    }

    if (current.length > 0) lines.push(current);
    return lines;
}