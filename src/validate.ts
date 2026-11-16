import { isSecretKey, parseEnv } from "./parse.js";
import { parseInlineRule } from "./schema.js";
import type {
  DiffResult,
  EnvEntry,
  Issue,
  ParseResult,
  Schema,
  SchemaRule,
  Severity,
  ValidationOptions,
  ValidationResult,
} from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_RE = /^(changeme|change-me|xxx+|todo|placeholder|your[-_ ]?(secret|key|password|value)|test|demo|example|1234+|password\d*)$/i;

/**
 * Validate an env file against an example file and a schema.
 *
 * Security rule: no issue message ever contains a value from the env file.
 * Messages name the key, the file and the line, and describe what is wrong
 * in general terms (expected type, placeholder shape, whitespace) — so a
 * secret can never leak through a CI log.
 */
export function validate(
  env: ParseResult,
  example: ParseResult,
  schema: Schema,
  options: ValidationOptions = {},
): ValidationResult {
  const issues: Issue[] = [];
  const strict = options.strict === true;
  const failOnEmpty = options.failOnEmpty === true || strict;

  for (const err of env.parseErrors) {
    issues.push({ code: "parse-error", severity: "error", message: err.message, file: err.file, line: err.line });
  }
  for (const err of example.parseErrors) {
    issues.push({ code: "parse-error", severity: "error", message: err.message, file: err.file, line: err.line });
  }

  for (const dup of env.duplicates) {
    issues.push({
      code: "duplicate",
      severity: "error",
      key: dup.key,
      message: `Duplicate key ${dup.key} — only the first occurrence is used.`,
      file: dup.file,
      line: dup.line,
      hint: "Remove the duplicate line.",
    });
  }

  // Inline rules come from the example file's comments (same line or line above).
  const inline = inlineRules(example);

  let missing = 0;
  let empty = 0;
  let extra = 0;

  for (const ex of example.entries) {
    const found = env.byKey.get(ex.key);
    if (!found) {
      missing++;
      issues.push({
        code: "missing",
        severity: "error",
        key: ex.key,
        message: `Missing required key ${ex.key} (present in ${ex.file}).`,
        file: env.entries[0]?.file ?? ".env",
        hint: `Add ${ex.key} to your .env file.`,
      });
      continue;
    }
    if (found.value === "") {
      empty++;
      issues.push({
        code: "empty",
        severity: failOnEmpty ? "error" : "warning",
        key: found.key,
        message: `Key ${found.key} is empty.`,
        file: found.file,
        line: found.line,
        hint: "Set a value, or remove the key from .env.example if it is optional.",
      });
    }
    checkType(found, ruleFor(ex.key, schema, inline), issues);
    checkSecretShape(found, issues, strict);
  }

  for (const entry of env.entries) {
    if (!example.byKey.has(entry.key)) {
      extra++;
      issues.push({
        code: "extra",
        severity: strict ? "error" : "warning",
        key: entry.key,
        message: `Key ${entry.key} is not listed in .env.example.`,
        file: entry.file,
        line: entry.line,
        hint: "Add it to .env.example, or remove it if it is no longer used.",
      });
    }
    // Type/secret checks also apply to extra keys when a schema rule exists.
    if (!example.byKey.has(entry.key)) {
      checkType(entry, ruleFor(entry.key, schema, inline), issues);
      checkSecretShape(entry, issues, strict);
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return {
    issues,
    errors,
    warnings,
    ok: errors.length === 0,
    summary: {
      total: issues.length,
      errors: errors.length,
      warnings: warnings.length,
      checked: example.entries.length,
      missing,
      empty,
      extra,
    },
  };
}

function ruleFor(key: string, schema: Schema, inline: Map<string, SchemaRule>): SchemaRule | undefined {
  return schema[key] ?? inline.get(key);
}

function inlineRules(example: ParseResult): Map<string, SchemaRule> {
  // Re-parse the example text is not possible here (we only have entries),
  // so inline rules come from each entry's own trailing comment.
  const map = new Map<string, SchemaRule>();
  for (const entry of example.entries) {
    const rule = parseInlineRule(entry.comment);
    if (rule) map.set(entry.key, rule);
  }
  return map;
}

function checkType(entry: EnvEntry, rule: SchemaRule | undefined, issues: Issue[]): void {
  if (!rule || !rule.type || entry.value === "") return;
  const fail = (expected: string, hint?: string) =>
    issues.push({
      code: "invalid-type",
      severity: "error",
      key: entry.key,
      message: `Key ${entry.key} is not a valid ${expected}.`,
      file: entry.file,
      line: entry.line,
      hint,
    });

  switch (rule.type) {
    case "port": {
      const n = Number(entry.value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) fail("port (integer 1-65535)", "Use a port such as 3000.");
      break;
    }
    case "url": {
      try {
        const url = new URL(entry.value);
        if (url.protocol !== "http:" && url.protocol !== "https:") fail("URL (http or https)");
      } catch {
        fail("URL (http or https)", "Use a full URL starting with http:// or https://.");
      }
      break;
    }
    case "boolean": {
      if (!/^(true|false)$/i.test(entry.value)) fail("boolean (true or false)");
      break;
    }
    case "number": {
      if (entry.value.trim() === "" || Number.isNaN(Number(entry.value))) fail("number");
      break;
    }
    case "email": {
      if (!EMAIL_RE.test(entry.value)) fail("email address");
      break;
    }
    case "enum": {
      if (rule.enum && !rule.enum.includes(entry.value)) {
        fail(`one of the allowed values for ${entry.key}`, "See env.schema.json for the allowed values.");
      }
      break;
    }
    case "regex": {
      if (rule.pattern) {
        let re: RegExp;
        try {
          re = new RegExp(rule.pattern);
        } catch {
          break;
        }
        if (!re.test(entry.value)) fail("value matching the configured pattern");
      }
      break;
    }
    case "string":
    default:
      break;
  }
}

function checkSecretShape(entry: EnvEntry, issues: Issue[], strict = false): void {
  const severity: Severity = strict ? "error" : "warning";
  if (!isSecretKey(entry.key) || entry.value === "") return;
  // Whitespace around a secret is almost always a copy-paste accident.
  if (entry.rawValue !== entry.rawValue.trim() || /^\s|\s$/.test(entry.value)) {
    issues.push({
      code: "secret-shape",
      severity,
      key: entry.key,
      message: `Key ${entry.key} has leading or trailing whitespace.`,
      file: entry.file,
      line: entry.line,
      hint: "Remove surrounding spaces — they become part of the secret.",
    });
  }
  if (entry.quoted) {
    issues.push({
      code: "secret-shape",
      severity,
      key: entry.key,
      message: `Key ${entry.key} is wrapped in quotes.`,
      file: entry.file,
      line: entry.line,
      hint: "Check whether the quotes are part of the value in your runtime.",
    });
  }
  if (PLACEHOLDER_RE.test(entry.value)) {
    issues.push({
      code: "secret-shape",
      severity,
      key: entry.key,
      message: `Key ${entry.key} looks like a placeholder value.`,
      file: entry.file,
      line: entry.line,
      hint: "Replace it with a real secret before deploying.",
    });
  }
}

/** Compare two parsed env files. Values are never included in the result. */
export function diffEnvs(a: ParseResult, b: ParseResult): DiffResult {
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const differentValues: string[] = [];

  for (const key of a.byKey.keys()) {
    if (!b.byKey.has(key)) onlyInA.push(key);
    else if (a.byKey.get(key)?.value !== b.byKey.get(key)?.value) differentValues.push(key);
  }
  for (const key of b.byKey.keys()) {
    if (!a.byKey.has(key)) onlyInB.push(key);
  }
  return {
    onlyInA: onlyInA.sort(),
    onlyInB: onlyInB.sort(),
    differentValues: differentValues.sort(),
    identical: onlyInA.length === 0 && onlyInB.length === 0 && differentValues.length === 0,
  };
}

export function diffToIssues(diff: DiffResult, fileA: string, fileB: string): Issue[] {
  const issues: Issue[] = [];
  for (const key of diff.onlyInA) {
    issues.push({ code: "diff-only-in-a", severity: "warning", key, message: `Key ${key} is only present in ${fileA}.`, file: fileA });
  }
  for (const key of diff.onlyInB) {
    issues.push({ code: "diff-only-in-b", severity: "warning", key, message: `Key ${key} is only present in ${fileB}.`, file: fileB });
  }
  for (const key of diff.differentValues) {
    issues.push({ code: "diff-value", severity: "warning", key, message: `Key ${key} has a different value in ${fileA} and ${fileB}.`, file: fileA });
  }
  return issues;
}

export { parseEnv };
