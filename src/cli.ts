#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { inferRule, isSecretKey, parseEnv } from "./parse.js";
import { loadSchemaFile, loadSchemaForEnv, mergeRules, parseInlineRule } from "./schema.js";
import { diffEnvs, diffToIssues, validate } from "./validate.js";
import { missingKeys, placeholderFor } from "./fix.js";
import {
  formatDiffJson,
  formatDiffText,
  formatExportJson,
  formatExportYaml,
  formatJson,
  formatText,
} from "./report.js";
import type { Schema } from "./types.js";
import type { ExportEntry } from "./report.js";

export const VERSION = "0.2.0";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Flags {
  json: boolean;
  strict: boolean;
  failOnEmpty: boolean;
  schema?: string;
  force: boolean;
  outExample?: string;
  outSchema?: string;
  env?: string;
  format?: string;
  includeValues: boolean;
}

function parseFlags(args: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = { json: false, strict: false, failOnEmpty: false, force: false, includeValues: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--json") flags.json = true;
    else if (arg === "--strict") flags.strict = true;
    else if (arg === "--fail-on-empty") flags.failOnEmpty = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--include-values") flags.includeValues = true;
    else if (arg === "--schema") flags.schema = args[++i];
    else if (arg.startsWith("--schema=")) flags.schema = arg.slice("--schema=".length);
    else if (arg === "--env") flags.env = args[++i];
    else if (arg.startsWith("--env=")) flags.env = arg.slice("--env=".length);
    else if (arg === "--format") flags.format = args[++i];
    else if (arg.startsWith("--format=")) flags.format = arg.slice("--format=".length);
    else if (arg === "--out-example") flags.outExample = args[++i];
    else if (arg.startsWith("--out-example=")) flags.outExample = arg.slice("--out-example=".length);
    else if (arg === "--out-schema") flags.outSchema = args[++i];
    else if (arg.startsWith("--out-schema=")) flags.outSchema = arg.slice("--out-schema=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    else positionals.push(arg);
  }
  return { positionals, flags };
}

function helpText(): string {
  return [
    "dotenv-doctor — fail-fast .env checker",
    "",
    "Usage:",
    "  dotenv-doctor check [env] [example] [--env staging] [--schema env.schema.json] [--strict] [--fail-on-empty] [--json]",
    "  dotenv-doctor init [env] [--out-example .env.example] [--out-schema env.schema.json] [--force]",
    "  dotenv-doctor diff <file-a> <file-b> [--json]",
    "  dotenv-doctor fix [env] [example] [--env staging] [--force]",
    "  dotenv-doctor export [env] [example] [--env staging] [--format json|yaml] [--include-values]",
    "  dotenv-doctor --help | --version",
    "",
    "check  Compare a .env file against .env.example (defaults: .env and .env.example).",
    "       Reports missing, empty and extra keys with file+line, validates types",
    "       (port, url, boolean, number, email, enum, regex) from env.schema.json",
    "       or inline `# @type …` comments, and warns about secret-shaped values",
    "       (whitespace, quotes, changeme/xxx) without ever printing a value.",
    "       Exit 0 when there are no errors, 1 otherwise.",
    "       --strict also fails on warnings; --fail-on-empty fails on empty values.",
    "       --env staging checks .env.staging instead, applying per-env schema",
    "       overrides from the schema file's `envs` map or env.schema.staging.json.",
    "init   Generate a redacted .env.example and env.schema.json from a .env file.",
    "       Values are never copied — secret keys become empty, other keys get a",
    "       type comment. Refuses to overwrite existing files unless --force is given.",
    "diff   Compare two env files by key. Only key names are reported, never values.",
    "fix    Add missing keys (present in .env.example, absent in .env) with safe",
    "       placeholder values — typed keys get a type-valid placeholder, secret",
    "       keys get CHANGE_ME, which check flags until you replace it. The",
    "       original file is backed up to <env>.bak first; if a backup already",
    "       exists, fix refuses unless --force is given. Never writes real secrets.",
    "export Print the validated config as JSON (default) or YAML. Values are",
    "       redacted as \"<redacted>\" unless --include-values is passed, which",
    "       prints a warning to stderr — never share that output. Export fails",
    "       (exit 1, nothing printed) when validation finds errors.",
    "",
    "Existing tools such as dotenv-safe and envalid solve similar problems;",
    "dotenv-doctor is a standalone pre-deploy checker with no runtime dependencies.",
  ].join("\n");
}

function loadSchema(flags: Flags): Schema {
  return loadSchemaForEnv(flags.schema, flags.env);
}

/** Shared loader for check/fix/export: resolves env + example files and the merged schema. */
function loadEnvPair(positionals: string[], flags: Flags): {
  envFile: string;
  exampleFile: string;
  schema: Schema;
  env: ReturnType<typeof parseEnv>;
  example: ReturnType<typeof parseEnv>;
  error?: RunResult;
} {
  const envFile = positionals[0] ?? (flags.env ? `.env.${flags.env}` : ".env");
  const exampleFile = positionals[1] ?? ".env.example";
  if (!existsSync(envFile)) {
    return {
      envFile,
      exampleFile,
      schema: {},
      env: parseEnv("", envFile),
      example: parseEnv("", exampleFile),
      error: { exitCode: 1, stdout: "", stderr: `dotenv-doctor: env file not found: ${envFile}\n` },
    };
  }
  if (!existsSync(exampleFile)) {
    return {
      envFile,
      exampleFile,
      schema: {},
      env: parseEnv("", envFile),
      example: parseEnv("", exampleFile),
      error: { exitCode: 1, stdout: "", stderr: `dotenv-doctor: example file not found: ${exampleFile}\n` },
    };
  }
  let schema: Schema;
  try {
    schema = loadSchema(flags);
  } catch (err) {
    return {
      envFile,
      exampleFile,
      schema: {},
      env: parseEnv("", envFile),
      example: parseEnv("", exampleFile),
      error: { exitCode: 1, stdout: "", stderr: `dotenv-doctor: ${(err as Error).message}\n` },
    };
  }
  const env = parseEnv(readFileSync(envFile, "utf8"), envFile);
  const example = parseEnv(readFileSync(exampleFile, "utf8"), exampleFile);
  const inline = new Map();
  for (const entry of example.entries) {
    const rule = parseInlineRule(entry.comment);
    if (rule) inline.set(entry.key, rule);
  }
  return { envFile, exampleFile, schema: mergeRules(schema, inline), env, example };
}

function checkCommand(positionals: string[], flags: Flags): RunResult {
  const pair = loadEnvPair(positionals, flags);
  if (pair.error) return pair.error;
  const result = validate(pair.env, pair.example, pair.schema, {
    strict: flags.strict,
    failOnEmpty: flags.failOnEmpty,
  });
  const stdout = flags.json ? formatJson(result) + "\n" : formatText(result, pair.envFile, pair.exampleFile) + "\n";
  return { exitCode: result.ok ? 0 : 1, stdout, stderr: "" };
}

/** Add missing keys with safe placeholders, backing the original up to <env>.bak. */
function fixCommand(positionals: string[], flags: Flags): RunResult {
  const envFile = positionals[0] ?? (flags.env ? `.env.${flags.env}` : ".env");
  const exampleFile = positionals[1] ?? ".env.example";
  if (!existsSync(exampleFile)) {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: example file not found: ${exampleFile}\n` };
  }
  let schema: Schema;
  try {
    schema = loadSchema(flags);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: ${(err as Error).message}\n` };
  }
  const example = parseEnv(readFileSync(exampleFile, "utf8"), exampleFile);
  const inline = new Map();
  for (const entry of example.entries) {
    const rule = parseInlineRule(entry.comment);
    if (rule) inline.set(entry.key, rule);
  }
  const merged = mergeRules(schema, inline);

  // Env file does not exist yet: create it from the example with placeholders.
  if (!existsSync(envFile)) {
    const lines = example.entries.map((entry) => {
      const value = placeholderFor(merged[entry.key], entry.key);
      return `${entry.key}=${value}`;
    });
    writeFileSync(envFile, lines.join("\n") + "\n", "utf8");
    return {
      exitCode: 0,
      stdout:
        `dotenv-doctor: created ${envFile} with ${lines.length} key(s) ` +
        `(placeholders only — replace CHANGE_ME values with real secrets).\n`,
      stderr: "",
    };
  }

  const env = parseEnv(readFileSync(envFile, "utf8"), envFile);
  const missing = missingKeys(env, example);
  if (missing.length === 0) {
    return { exitCode: 0, stdout: `dotenv-doctor: nothing to fix — ${envFile} has every key in ${exampleFile}.\n`, stderr: "" };
  }
  const backupFile = `${envFile}.bak`;
  if (!flags.force && existsSync(backupFile)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `dotenv-doctor: refusing to overwrite existing backup ${backupFile} (use --force)\n`,
    };
  }
  copyFileSync(envFile, backupFile);
  const original = readFileSync(envFile, "utf8");
  const lines = missing.map((entry) => {
    const value = placeholderFor(merged[entry.key], entry.key);
    const note = value === "CHANGE_ME" ? " # added by dotenv-doctor fix — replace with a real value" : "";
    return `${entry.key}=${value}${note}`;
  });
  const separator = original === "" || original.endsWith("\n") ? "" : "\n";
  writeFileSync(envFile, original + separator + lines.join("\n") + "\n", "utf8");
  return {
    exitCode: 0,
    stdout:
      `dotenv-doctor: added ${missing.length} missing key(s) to ${envFile} ` +
      `(${missing.map((e) => e.key).join(", ")}); backup saved to ${backupFile}. ` +
      `Replace CHANGE_ME values with real secrets before deploying.\n`,
    stderr: "",
  };
}

/** Export the validated config as JSON or YAML, values redacted by default. */
function exportCommand(positionals: string[], flags: Flags): RunResult {
  const format = flags.format ?? "json";
  if (format !== "json" && format !== "yaml") {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: unknown export format: ${format} (use json or yaml)\n` };
  }
  const pair = loadEnvPair(positionals, flags);
  if (pair.error) return pair.error;
  const result = validate(pair.env, pair.example, pair.schema, {
    strict: flags.strict,
    failOnEmpty: flags.failOnEmpty,
  });
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr:
        `dotenv-doctor: validation failed (${result.summary.errors} error(s)) — ` +
        `fix the config first, nothing was exported.\n`,
    };
  }
  const entries: ExportEntry[] = pair.example.entries.map((entry) => {
    const found = pair.env.byKey.get(entry.key);
    const rule = pair.schema[entry.key];
    return {
      key: entry.key,
      type: rule?.type ?? "string",
      value: flags.includeValues && found ? found.value : "<redacted>",
      present: found !== undefined,
    };
  });
  const stdout =
    (format === "yaml" ? formatExportYaml(flags.env, entries) : formatExportJson(flags.env, entries)) + "\n";
  const stderr = flags.includeValues
    ? "dotenv-doctor: WARNING — --include-values prints real values. Do not share this output.\n"
    : "";
  return { exitCode: 0, stdout, stderr };
}

function initCommand(positionals: string[], flags: Flags): RunResult {
  const envFile = positionals[0] ?? ".env";
  const outExample = flags.outExample ?? ".env.example";
  const outSchema = flags.outSchema ?? "env.schema.json";
  if (!existsSync(envFile)) {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: env file not found: ${envFile}\n` };
  }
  if (!flags.force && (existsSync(outExample) || existsSync(outSchema))) {
    const existing = [outExample, outSchema].filter((p) => existsSync(p)).join(", ");
    return {
      exitCode: 1,
      stdout: "",
      stderr: `dotenv-doctor: refusing to overwrite existing file(s): ${existing} (use --force)\n`,
    };
  }

  const parsed = parseEnv(readFileSync(envFile, "utf8"), envFile);
  const schema: Schema = {};
  const lines: string[] = [
    "# Generated by dotenv-doctor init — values are intentionally redacted.",
    "# Fill in real values in your own .env file; never commit secrets.",
    "",
  ];
  for (const entry of parsed.entries) {
    const inferred = inferRule(entry.key, entry.value);
    schema[entry.key] = { type: inferred.type as Schema["string"]["type"] };
    const comment = isSecretKey(entry.key)
      ? "# secret — leave empty in the example"
      : `# @type ${inferred.type}`;
    lines.push(`${entry.key}= ${comment}`);
  }
  writeFileSync(outExample, lines.join("\n") + "\n", "utf8");
  writeFileSync(outSchema, JSON.stringify(schema, null, 2) + "\n", "utf8");
  return {
    exitCode: 0,
    stdout: `dotenv-doctor: wrote ${outExample} and ${outSchema} (${parsed.entries.length} key(s), values redacted).\n`,
    stderr: "",
  };
}

function diffCommand(positionals: string[], flags: Flags): RunResult {
  const [fileA, fileB] = positionals;
  if (!fileA || !fileB) {
    return { exitCode: 1, stdout: "", stderr: "dotenv-doctor: diff needs two files: dotenv-doctor diff <file-a> <file-b>\n" };
  }
  if (!existsSync(fileA) || !existsSync(fileB)) {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: file not found: ${!existsSync(fileA) ? fileA : fileB}\n` };
  }
  const a = parseEnv(readFileSync(fileA, "utf8"), fileA);
  const b = parseEnv(readFileSync(fileB, "utf8"), fileB);
  const diff = diffEnvs(a, b);
  void diffToIssues(diff, fileA, fileB);
  const stdout = flags.json ? formatDiffJson(diff) + "\n" : formatDiffText(diff, fileA, fileB) + "\n";
  return { exitCode: diff.identical ? 0 : 1, stdout, stderr: "" };
}

/** Run the CLI with the given argv (without the node/script prefix). Testable without process.exit. */
export function run(argv: string[]): RunResult {
  if (argv.length === 0)
    return checkCommand([], { json: false, strict: false, failOnEmpty: false, force: false, includeValues: false });
  const [first, ...rest] = argv as [string, ...string[]];
  if (first === "--help" || first === "-h" || first === "help") {
    return { exitCode: 0, stdout: helpText() + "\n", stderr: "" };
  }
  if (first === "--version" || first === "-v" || first === "version") {
    return { exitCode: 0, stdout: `dotenv-doctor ${VERSION}\n`, stderr: "" };
  }
  try {
    const { positionals, flags } = parseFlags(rest);
    if (first === "check") return checkCommand(positionals, flags);
    if (first === "init") return initCommand(positionals, flags);
    if (first === "diff") return diffCommand(positionals, flags);
    if (first === "fix") return fixCommand(positionals, flags);
    if (first === "export") return exportCommand(positionals, flags);
    // A bare file path is treated as `check <file>`.
    const { positionals: pos2, flags: flags2 } = parseFlags(argv);
    return checkCommand(pos2, flags2);
  } catch (err) {
    return { exitCode: 1, stdout: "", stderr: `dotenv-doctor: ${(err as Error).message}\n` };
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.ts") || process.argv[1].endsWith("dotenv-doctor"));
if (isMain) {
  const result = run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
