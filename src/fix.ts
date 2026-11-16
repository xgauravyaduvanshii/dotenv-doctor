import { isSecretKey } from "./parse.js";
import type { EnvEntry, ParseResult, SchemaRule } from "./types.js";

/**
 * Safe placeholder value for a missing key, based on its schema rule.
 *
 * Placeholders are deliberately NOT real values: typed keys get a
 * type-valid placeholder (port 3000, url https://example.com, …) so the
 * file passes `check` structurally, while secret / string keys get
 * `CHANGE_ME`, which `check` flags as a placeholder — the user must
 * replace it with a real secret before deploying. Never returns a value
 * copied from any existing file.
 */
export function placeholderFor(rule: SchemaRule | undefined, key: string): string {
  void key;
  switch (rule?.type) {
    case "port":
      return "3000";
    case "url":
      return "https://example.com";
    case "boolean":
      return "false";
    case "number":
      return "0";
    case "email":
      return "user@example.com";
    case "enum":
      return rule.enum && rule.enum.length > 0 ? (rule.enum[0] as string) : "CHANGE_ME";
    case "regex":
    case "string":
    default:
      return "CHANGE_ME";
  }
}

/** Keys present in the example file but missing from the env file, in example order. */
export function missingKeys(env: ParseResult, example: ParseResult): EnvEntry[] {
  return example.entries.filter((entry) => !env.byKey.has(entry.key));
}

export function isPlaceholderValue(value: string): boolean {
  return value === "CHANGE_ME";
}

export { isSecretKey };
