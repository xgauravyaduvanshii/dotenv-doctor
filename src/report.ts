import type { DiffResult, Issue, ValidationResult } from "./types.js";

/**
 * Render results for humans and for CI.
 *
 * The reporter is the last line of defence against secret leakage:
 * it only ever renders `issue.message` (which by construction contains no
 * values), keys, file names and line numbers — never a raw env value.
 */
export function formatText(result: ValidationResult, envFile: string, exampleFile: string): string {
  const lines: string[] = [];
  lines.push(`dotenv-doctor: ${envFile} vs ${exampleFile}`);
  if (result.issues.length === 0) {
    lines.push("OK — no issues found.");
    return lines.join("\n");
  }
  for (const issue of result.issues) {
    lines.push(formatIssueLine(issue));
  }
  lines.push(
    `${result.summary.errors} error(s), ${result.summary.warnings} warning(s) — ` +
      `${result.summary.checked} key(s) checked, ${result.summary.missing} missing, ` +
      `${result.summary.empty} empty, ${result.summary.extra} extra.`,
  );
  return lines.join("\n");
}

export function formatIssueLine(issue: Issue): string {
  const loc = [issue.file, issue.line ? `:${issue.line}` : ""].join("");
  const prefix = issue.severity === "error" ? "ERROR" : "WARN";
  const hint = issue.hint ? ` Hint: ${issue.hint}` : "";
  return `${prefix} [${issue.code}]${loc ? ` ${loc}` : ""} ${issue.message}${hint}`;
}

export function formatJson(result: ValidationResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      summary: result.summary,
      issues: result.issues.map((i) => ({
        code: i.code,
        severity: i.severity,
        key: i.key ?? null,
        message: i.message,
        file: i.file ?? null,
        line: i.line ?? null,
        hint: i.hint ?? null,
      })),
    },
    null,
    2,
  );
}

export function formatDiffText(diff: DiffResult, fileA: string, fileB: string): string {
  if (diff.identical) return `dotenv-doctor diff: ${fileA} and ${fileB} are identical (same keys and values).`;
  const lines = [`dotenv-doctor diff: ${fileA} vs ${fileB}`];
  for (const key of diff.onlyInA) lines.push(`WARN [diff-only-in-a] ${key} is only present in ${fileA}.`);
  for (const key of diff.onlyInB) lines.push(`WARN [diff-only-in-b] ${key} is only present in ${fileB}.`);
  for (const key of diff.differentValues) {
    lines.push(`WARN [diff-value] ${key} has a different value in ${fileA} and ${fileB}.`);
  }
  return lines.join("\n");
}

export function formatDiffJson(diff: DiffResult): string {
  return JSON.stringify(
    {
      ok: diff.identical,
      onlyInA: diff.onlyInA,
      onlyInB: diff.onlyInB,
      differentValues: diff.differentValues,
    },
    null,
    2,
  );
}

export interface ExportEntry {
  key: string;
  type?: string;
  /** Value as stored, or "<redacted>" when values are hidden. Never null. */
  value: string;
  present: boolean;
}

/** Quote a scalar for YAML output. JSON double-quoting is valid YAML. */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * Export the validated config as JSON. Values are "<redacted>" unless the
 * caller explicitly included them (see `export` in cli.ts, which warns).
 */
export function formatExportJson(envName: string | undefined, entries: ExportEntry[]): string {
  const keys: Record<string, { type: string; value: string; present: boolean }> = {};
  for (const entry of entries) {
    keys[entry.key] = { type: entry.type ?? "string", value: entry.value, present: entry.present };
  }
  return JSON.stringify({ env: envName ?? null, keys }, null, 2);
}

/** Export the validated config as YAML, same shape as `formatExportJson`. */
export function formatExportYaml(envName: string | undefined, entries: ExportEntry[]): string {
  const lines: string[] = [];
  lines.push(`env: ${envName ? yamlScalar(envName) : "null"}`);
  lines.push("keys:");
  for (const entry of entries) {
    lines.push(`  ${entry.key}:`);
    lines.push(`    type: ${yamlScalar(entry.type ?? "string")}`);
    lines.push(`    value: ${yamlScalar(entry.value)}`);
    lines.push(`    present: ${entry.present ? "true" : "false"}`);
  }
  return lines.join("\n");
}
