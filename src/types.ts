export type Severity = "error" | "warning";

export type IssueCode =
  | "missing"
  | "empty"
  | "extra"
  | "duplicate"
  | "invalid-type"
  | "secret-shape"
  | "diff-only-in-a"
  | "diff-only-in-b"
  | "diff-value"
  | "parse-error";

export interface EnvEntry {
  key: string;
  /** Decoded value (quotes removed, escapes handled for double quotes). Never printed by the reporter. */
  value: string;
  /** Raw text after `=` on the source line, before decoding. Never printed by the reporter. */
  rawValue: string;
  line: number;
  file: string;
  quoted: boolean;
  /** Trailing comment text after the value, if any (without the leading `#`). */
  comment?: string;
}

export interface ParseResult {
  entries: EnvEntry[];
  /** Map of key -> first entry. Duplicates are kept in `entries` and reported separately. */
  byKey: Map<string, EnvEntry>;
  duplicates: EnvEntry[];
  parseErrors: { line: number; file: string; message: string }[];
}

export type RuleType =
  | "port"
  | "url"
  | "boolean"
  | "number"
  | "email"
  | "enum"
  | "regex"
  | "string";

export interface SchemaRule {
  type?: RuleType;
  enum?: string[];
  pattern?: string;
  required?: boolean;
  description?: string;
}

export type Schema = Record<string, SchemaRule>;

export interface Issue {
  code: IssueCode;
  severity: Severity;
  /** Key involved, if any. Values are never included in an issue. */
  key?: string;
  message: string;
  file?: string;
  line?: number;
  hint?: string;
}

export interface ValidationOptions {
  strict?: boolean;
  failOnEmpty?: boolean;
}

export interface ValidationResult {
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
  ok: boolean;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    checked: number;
    missing: number;
    empty: number;
    extra: number;
  };
}

export interface DiffResult {
  onlyInA: string[];
  onlyInB: string[];
  /** Keys present in both files whose values differ. Values are never reported. */
  differentValues: string[];
  identical: boolean;
}
