import { readFileSync } from "node:fs";
import type { Schema, SchemaRule } from "./types.js";

/**
 * Load a schema from `env.schema.json`.
 * Returns an empty schema when the file does not exist; throws on invalid JSON.
 */
export function loadSchemaFile(path: string): Schema {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Schema file ${path} must contain a JSON object mapping keys to rules.`);
  }
  const schema: Schema = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Schema rule for ${key} must be an object.`);
    }
    schema[key] = value as SchemaRule;
  }
  return schema;
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
