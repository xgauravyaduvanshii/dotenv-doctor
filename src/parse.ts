import type { EnvEntry, ParseResult } from "./types.js";

const KEY_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Parse `.env`-style content.
 *
 * Supports `export KEY=value`, single/double quotes, `#` comments
 * (a `#` inside quotes is part of the value), and empty values.
 * Line numbers are preserved so every finding can point at a file+line.
 * Values are kept in memory for validation but must never be printed —
 * see `report.ts`, which only ever renders keys, never values.
 */
export function parseEnv(content: string, file: string): ParseResult {
  const entries: EnvEntry[] = [];
  const byKey = new Map<string, EnvEntry>();
  const duplicates: EnvEntry[] = [];
  const parseErrors: ParseResult["parseErrors"] = [];

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = KEY_RE.exec(line);
    if (!match) {
      parseErrors.push({
        line: lineNo,
        file,
        message: "Line is not a KEY=value assignment.",
      });
      continue;
    }

    const key = match[1] as string;
    const rest = (match[2] ?? "").trim();
    const { value, rawValue, quoted, comment } = splitValue(rest);

    const entry: EnvEntry = { key, value, rawValue, line: lineNo, file, quoted, comment };
    if (byKey.has(key)) duplicates.push(entry);
    else byKey.set(key, entry);
    entries.push(entry);
  }

  return { entries, byKey, duplicates, parseErrors };
}

function splitValue(rest: string): {
  value: string;
  rawValue: string;
  quoted: boolean;
  comment?: string;
} {
  if (rest === "") return { value: "", rawValue: "", quoted: false };

  const first = rest[0];
  if (first === '"' || first === "'") {
    const quote = first;
    let j = 1;
    let value = "";
    let closed = false;
    while (j < rest.length) {
      const ch = rest[j] as string;
      if (quote === '"' && ch === "\\" && j + 1 < rest.length) {
        const next = rest[j + 1] as string;
        value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
        j += 2;
        continue;
      }
      if (ch === quote) {
        closed = true;
        j++;
        break;
      }
      value += ch;
      j++;
    }
    const after = rest.slice(j).trim();
    const comment = closed && after.startsWith("#") ? after.slice(1).trim() : undefined;
    // If the quote never closed, treat the whole remainder as the raw value.
    if (!closed) return { value: rest, rawValue: rest, quoted: false };
    return { value, rawValue: rest.slice(0, j), quoted: true, comment };
  }

  // Unquoted: a ` #` (space + hash) starts a trailing comment.
  const hashAt = rest.indexOf(" #");
  if (hashAt >= 0) {
    return {
      value: rest.slice(0, hashAt).trimEnd(),
      rawValue: rest.slice(0, hashAt).trimEnd(),
      quoted: false,
      comment: rest.slice(hashAt + 2).trim(),
    };
  }
  return { value: rest, rawValue: rest, quoted: false };
}

/** Keys that look like they hold a secret, by naming convention. */
export function isSecretKey(key: string): boolean {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API[_-]?KEY|AUTH|CREDENTIAL|SESSION)/i.test(key);
}

/** Infer a plausible rule from a key name and value shape — used only by `init`. */
export function inferRule(key: string, value: string): { type: string; enum?: string[] } {
  if (/PORT$/i.test(key) || key === "PORT") return { type: "port" };
  if (/(_URL|_URI|_ENDPOINT)$/i.test(key)) return { type: "url" };
  if (/^(true|false)$/i.test(value)) return { type: "boolean" };
  if (/^-?\d+(\.\d+)?$/.test(value)) return { type: "number" };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { type: "email" };
  if (isSecretKey(key)) return { type: "string" };
  return { type: "string" };
}
