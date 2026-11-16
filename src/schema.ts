import { existsSync, readFileSync } from "node:fs";
import type { Schema, SchemaRule } from "./types.js";

/**
 * Load a schema from `env.schema.json`.
 * Returns an empty schema when the file does not exist; throws on invalid JSON.
 * A top-level `envs` key (per-environment overrides, see below) is not a
 * rule and is skipped — use `loadSchemaForEnv` to apply it.
 */
export function loadSchemaFile(path: string): Schema {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Schema file ${path} must contain a JSON object mapping keys to rules.`);
  }
  const schema: Schema = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === "envs") continue;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Schema rule for ${key} must be an object.`);
    }
    schema[key] = value as SchemaRule;
  }
  return schema;
}

/**
 * Per-environment overrides from a schema file's top-level `envs` map:
 * `{ "envs": { "staging": { "NODE_ENV": { "type": "enum", "enum": ["staging", "production"] } } } }`.
 * Returns {} when the file is missing or has no overrides for `env`.
 */
export function loadEnvOverrides(path: string, env: string): Schema {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const envs = (parsed as Record<string, unknown>)["envs"];
  if (envs === null || typeof envs !== "object" || Array.isArray(envs)) return {};
  const override = (envs as Record<string, unknown>)[env];
  if (override === null || typeof override !== "object" || Array.isArray(override)) return {};
  const schema: Schema = {};
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      schema[key] = value as SchemaRule;
    }
  }
  return schema;
}

/**
 * Resolve the schema for one environment: base rules, then the `envs`
 * overrides from the same file, then — when using the default schema
 * location — a dedicated `env.schema.<env>.json` file on top.
 * Per-key rules are merged (an override only replaces the fields it sets).
 */
export function loadSchemaForEnv(schemaPath: string | undefined, env: string | undefined): Schema {
  const basePath = schemaPath ?? "env.schema.json";
  let base: Schema = {};
  if (existsSync(basePath)) base = loadSchemaFile(basePath);
  if (!env) return base;

  const merged: Schema = { ...base };
  const apply = (overrides: Schema) => {
    for (const [key, rule] of Object.entries(overrides)) {
      merged[key] = { ...(merged[key] ?? {}), ...rule };
    }
  };
  apply(loadEnvOverrides(basePath, env));
  if (!schemaPath) {
    const dedicated = `env.schema.${env}.json`;
    if (existsSync(dedicated)) apply(loadSchemaFile(dedicated));
  }
  return merged;
}

/**
 * Parse inline annotations from a comment string.
 * Supported forms (on the same line or the line above a key):
 *   # @type port | url | boolean | number | email | enum | regex | string
 *   # @enum a,b,c
 *   # @regex ^[a-z]+$
 *   # @required / # @optional
 */
export function parseInlineRule(comment: string | undefined): SchemaRule | undefined {
  if (!comment) return undefined;
  const rule: SchemaRule = {};
  let found = false;

  const typeMatch = /@type\s+([a-z]+)/i.exec(comment);
  if (typeMatch) {
    rule.type = typeMatch[1]?.toLowerCase() as SchemaRule["type"];
    found = true;
  }
  const enumMatch = /@enum\s+([^\s]+)/i.exec(comment);
  if (enumMatch) {
    rule.enum = (enumMatch[1] as string).split(",").map((s) => s.trim()).filter(Boolean);
    if (!rule.type) rule.type = "enum";
    found = true;
  }
  const regexMatch = /@regex\s+(\S+)/i.exec(comment);
  if (regexMatch) {
    rule.pattern = regexMatch[1];
    if (!rule.type) rule.type = "regex";
    found = true;
  }
  if (/@required\b/i.test(comment)) {
    rule.required = true;
    found = true;
  }
  if (/@optional\b/i.test(comment)) {
    rule.required = false;
    found = true;
  }
  return found ? rule : undefined;
}

/**
 * Merge rules: the JSON schema wins over inline comments, and inline
 * comments fill in keys the JSON schema does not cover.
 */
export function mergeRules(jsonSchema: Schema, inline: Map<string, SchemaRule>): Schema {
  const merged: Schema = Object.fromEntries(inline);
  for (const [key, rule] of Object.entries(jsonSchema)) {
    merged[key] = { ...(merged[key] ?? {}), ...rule };
  }
  return merged;
}
