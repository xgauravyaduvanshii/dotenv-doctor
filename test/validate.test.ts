import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/parse.js";
import { loadSchemaFile, mergeRules, parseInlineRule } from "../src/schema.js";
import { diffEnvs, validate } from "../src/validate.js";
import { formatJson, formatText } from "../src/report.js";

const EXAMPLE = `PORT=3000 # @type port
DATABASE_URL=https://db.example.com/app # @type url
NODE_ENV=development # @enum development,test,production
DEBUG=false # @type boolean
JWT_SECRET=
`;

function check(envText: string, schema = {}, options = {}) {
  const env = parseEnv(envText, ".env");
  const example = parseEnv(EXAMPLE, ".env.example");
  return validate(env, example, schema, options);
}

describe("validate", () => {
  it("passes a complete, well-typed env", () => {
    const result = check(
      "PORT=3000\nDATABASE_URL=https://db.example.com/app\nNODE_ENV=test\nDEBUG=true\nJWT_SECRET=some-real-secret\n",
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing keys as errors with file+line", () => {
    const result = check("PORT=3000\n");
    expect(result.ok).toBe(false);
    expect(result.summary.missing).toBe(4);
    expect(result.errors.some((i) => i.code === "missing" && i.key === "DATABASE_URL")).toBe(true);
  });

  it("reports invalid port, url, boolean and enum values as errors", () => {
    const result = check(
      "PORT=99999\nDATABASE_URL=not-a-url\nNODE_ENV=staging\nDEBUG=maybe\nJWT_SECRET=some-real-secret\n",
    );
    expect(result.errors.filter((i) => i.code === "invalid-type")).toHaveLength(4);
  });

  it("treats empty as a warning by default and as an error with --fail-on-empty", () => {
    const base =
      "PORT=3000\nDATABASE_URL=https://db.example.com/app\nNODE_ENV=development\nDEBUG=false\nJWT_SECRET=\n";
    const soft = check(base);
    expect(soft.issues.some((i) => i.code === "empty" && i.severity === "warning")).toBe(true);
    expect(soft.ok).toBe(true);
    const hard = check(base, {}, { failOnEmpty: true });
    expect(hard.issues.some((i) => i.code === "empty" && i.severity === "error")).toBe(true);
    expect(hard.ok).toBe(false);
  });

  it("reports extra keys as warnings, and as errors under --strict", () => {
    const env =
      "PORT=3000\nDATABASE_URL=https://db.example.com/app\nNODE_ENV=development\nDEBUG=false\nJWT_SECRET=x\nEXTRA=1\n";
    expect(check(env).issues.some((i) => i.code === "extra" && i.severity === "warning")).toBe(true);
    expect(check(env).ok).toBe(true);
    const strict = check(env, {}, { strict: true });
    expect(strict.issues.some((i) => i.code === "extra" && i.severity === "error")).toBe(true);
    expect(strict.ok).toBe(false);
  });

  it("warns on placeholder secrets without ever printing the value", () => {
    const result = check(
      "PORT=3000\nDATABASE_URL=https://db.example.com/app\nNODE_ENV=development\nDEBUG=false\nJWT_SECRET=changeme\n",
    );
    const secret = result.issues.filter((i) => i.code === "secret-shape");
    expect(secret.length).toBeGreaterThanOrEqual(1);
    const rendered = formatText(result, ".env", ".env.example") + formatJson(result);
    expect(rendered).not.toContain("changeme");
  });

  it("validates types from env.schema.json as well as inline comments", () => {
    const schema = loadSchemaFile("fixtures/env.schema.json");
    expect(schema.PORT?.type).toBe("port");
    const result = check(
      "PORT=abc\nDATABASE_URL=https://db.example.com/app\nNODE_ENV=development\nDEBUG=false\nJWT_SECRET=x\n",
      schema,
    );
    expect(result.errors.some((i) => i.code === "invalid-type" && i.key === "PORT")).toBe(true);
  });

  it("parses inline @type / @enum / @regex annotations", () => {
    expect(parseInlineRule("@type port")?.type).toBe("port");
    expect(parseInlineRule("@enum a,b,c")?.enum).toEqual(["a", "b", "c"]);
    expect(parseInlineRule("@regex ^[a-z]+$")?.pattern).toBe("^[a-z]+$");
    expect(parseInlineRule("just a note")).toBeUndefined();
  });

  it("merges JSON schema over inline rules", () => {
    const merged = mergeRules({ PORT: { type: "port" } }, new Map([["PORT", { type: "string" }]]));
    expect(merged.PORT?.type).toBe("port");
  });

  it("diffs two env files by key only, never by value", () => {
    const a = parseEnv("A=1\nB=2\nC=3\n", "a.env");
    const b = parseEnv("A=1\nB=changed\nD=4\n", "b.env");
    const diff = diffEnvs(a, b);
    expect(diff.onlyInA).toEqual(["C"]);
    expect(diff.onlyInB).toEqual(["D"]);
    expect(diff.differentValues).toEqual(["B"]);
    expect(diff.identical).toBe(false);
    expect(JSON.stringify(diff)).not.toContain("changed");
  });
});
