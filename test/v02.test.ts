import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { loadSchemaForEnv } from "../src/schema.js";
import { placeholderFor } from "../src/fix.js";

let savedCwd = "";
beforeEach(() => {
  savedCwd = process.cwd();
});
afterEach(() => {
  process.chdir(savedCwd);
});

function inTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dotenv-doctor-v02-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  process.chdir(dir);
  return dir;
}

const EXAMPLE = `PORT=3000 # @type port
DATABASE_URL=https://db.example.com/app # @type url
NODE_ENV=development # @enum development,test,production
DEBUG=false # @type boolean
JWT_SECRET=
`;
const GOOD = `PORT=3000
DATABASE_URL=https://db.example.com/app
NODE_ENV=development
DEBUG=false
JWT_SECRET=some-real-secret
`;
const STAGING = `PORT=3000
DATABASE_URL=https://db.example.com/app
NODE_ENV=staging
DEBUG=false
JWT_SECRET=staging-secret
`;

describe("v0.2.0 multi-env", () => {
  it("check --env staging loads .env.staging", () => {
    inTempDir({
      ".env.staging": STAGING,
      ".env.example": EXAMPLE,
      "env.schema.staging.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["staging", "production"] } }),
    });
    const result = run(["check", "--env", "staging"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("check --env staging fails when the staging file is missing", () => {
    inTempDir({ ".env.example": EXAMPLE });
    const result = run(["check", "--env", "staging"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(".env.staging");
  });

  it("per-env override from env.schema.<env>.json changes validation", () => {
    // NODE_ENV=staging fails the base schema (enum has no staging) but
    // passes with the staging override file — but only when the default
    // schema location is used; with an explicit --schema it does not apply.
    inTempDir({
      ".env.staging": STAGING,
      ".env.example": EXAMPLE,
      "env.schema.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["development", "test", "production"] } }),
      "env.schema.staging.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["staging", "production"] } }),
    });
    expect(run(["check", "--env", "staging"]).exitCode).toBe(0);
    expect(run(["check", "--env", "staging", "--schema", "env.schema.json"]).exitCode).toBe(1);
  });

  it("per-env overrides from the envs map in the schema file apply", () => {
    inTempDir({
      "env.schema.json": JSON.stringify({
        NODE_ENV: { type: "enum", enum: ["development", "test", "production"] },
        envs: { production: { NODE_ENV: { type: "enum", enum: ["production"] } } },
      }),
    });
    const schema = loadSchemaForEnv("env.schema.json", "production");
    expect(schema.NODE_ENV?.enum).toEqual(["production"]);
    const base = loadSchemaForEnv("env.schema.json", undefined);
    expect(base.NODE_ENV?.enum).toContain("development");
    expect(base.NODE_ENV?.enum).not.toContain("staging");
  });

  it("fixtures: staging file passes with the staging override file", () => {
    inTempDir({
      ".env.staging": STAGING,
      ".env.example": EXAMPLE,
      "env.schema.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["development", "test", "production"] } }),
      "env.schema.staging.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["staging", "production"] } }),
    });
    expect(run(["check", "--env", "staging"]).exitCode).toBe(0);
  });
});

describe("v0.2.0 fix", () => {
  it("adds missing keys with safe placeholders and backs up the original", () => {
    const dir = inTempDir({
      ".env": "PORT=3000\n",
      ".env.example": EXAMPLE,
      "env.schema.json": JSON.stringify({ PORT: { type: "port" }, NODE_ENV: { type: "enum", enum: ["development", "test", "production"] } }),
    });
    const result = run(["fix"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DATABASE_URL");
    expect(result.stdout).toContain(".env.bak");
    expect(existsSync(join(dir, ".env.bak"))).toBe(true);
    expect(readFileSync(join(dir, ".env.bak"), "utf8")).toBe("PORT=3000\n");
    const fixed = readFileSync(join(dir, ".env"), "utf8");
    expect(fixed).toContain("DATABASE_URL=https://example.com");
    expect(fixed).toContain("JWT_SECRET=CHANGE_ME");
    expect(fixed).toContain("NODE_ENV=development");
    expect(fixed).not.toContain("some-real-secret");
    // The fixed file now passes check structurally (CHANGE_ME is a warning, not an error).
    expect(run(["check"]).exitCode).toBe(0);
  });

  it("refuses to overwrite an existing backup without --force", () => {
    inTempDir({ ".env": "PORT=3000\n", ".env.example": EXAMPLE, ".env.bak": "old backup\n" });
    expect(run(["fix"]).exitCode).toBe(1);
    expect(run(["fix"]).stderr).toContain("backup");
    expect(run(["fix", "--force"]).exitCode).toBe(0);
  });

  it("reports nothing to fix when the env is complete", () => {
    inTempDir({ ".env": GOOD, ".env.example": EXAMPLE });
    const result = run(["fix"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("nothing to fix");
    expect(existsSync(".env.bak")).toBe(false);
  });

  it("creates the env file when it does not exist", () => {
    inTempDir({ ".env.example": EXAMPLE });
    const result = run(["fix"]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(".env")).toBe(true);
    expect(readFileSync(".env", "utf8")).toContain("JWT_SECRET=CHANGE_ME");
  });

  it("placeholderFor returns type-valid placeholders, never real secrets", () => {
    expect(placeholderFor({ type: "port" }, "PORT")).toBe("3000");
    expect(placeholderFor({ type: "url" }, "DATABASE_URL")).toBe("https://example.com");
    expect(placeholderFor({ type: "boolean" }, "DEBUG")).toBe("false");
    expect(placeholderFor({ type: "number" }, "N")).toBe("0");
    expect(placeholderFor({ type: "email" }, "E")).toBe("user@example.com");
    expect(placeholderFor({ type: "enum", enum: ["a", "b"] }, "E")).toBe("a");
    expect(placeholderFor({ type: "string" }, "JWT_SECRET")).toBe("CHANGE_ME");
    expect(placeholderFor(undefined, "FOO")).toBe("CHANGE_ME");
  });
});

describe("v0.2.0 export", () => {
  it("exports JSON with values redacted by default", () => {
    inTempDir({ ".env": GOOD, ".env.example": EXAMPLE });
    const result = run(["export"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { env: unknown; keys: Record<string, { value: string; type: string }> };
    expect(parsed.env).toBeNull();
    expect(parsed.keys.PORT?.value).toBe("<redacted>");
    expect(parsed.keys.PORT?.type).toBe("port");
    expect(result.stdout).not.toContain("some-real-secret");
    expect(result.stdout).not.toContain("db.example.com");
  });

  it("exports YAML with values redacted by default, and honours --env", () => {
    inTempDir({
      ".env.staging": STAGING,
      ".env.example": EXAMPLE,
      "env.schema.staging.json": JSON.stringify({ NODE_ENV: { type: "enum", enum: ["staging", "production"] } }),
    });
    const result = run(["export", "--env", "staging", "--format", "yaml"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('env: "staging"');
    expect(result.stdout).toContain('value: "<redacted>"');
    expect(result.stdout).not.toContain("staging-secret");
  });

  it("--include-values prints real values but warns on stderr", () => {
    inTempDir({ ".env": GOOD, ".env.example": EXAMPLE });
    const result = run(["export", "--include-values"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("some-real-secret");
    expect(result.stderr).toContain("WARNING");
    expect(result.stderr).toContain("--include-values");
  });

  it("export fails without output when validation finds errors", () => {
    inTempDir({ ".env": "PORT=99999\n", ".env.example": EXAMPLE });
    const result = run(["export"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("validation failed");
  });

  it("rejects an unknown export format", () => {
    inTempDir({ ".env": GOOD, ".env.example": EXAMPLE });
    const result = run(["export", "--format", "toml"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown export format");
  });
});
