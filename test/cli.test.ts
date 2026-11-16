import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const dirs: string[] = [];
afterEach(() => {
  // Tests run in a temp cwd; restore the project cwd after each test.
  process.chdir(join(process.cwd().split("/test")[0] ?? "."));
});

function inTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dotenv-doctor-"));
  dirs.push(dir);
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

describe("cli", () => {
  it("exits 0 for a good env and prints OK", () => {
    inTempDir({ ".env": GOOD, ".env.example": EXAMPLE });
    const result = run(["check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("exits 1 for a bad env and reports JSON when asked", () => {
    inTempDir({
      ".env": "PORT=99999\nDATABASE_URL=not-a-url\nNODE_ENV=staging\nDEBUG=maybe\nJWT_SECRET=changeme\n",
      ".env.example": EXAMPLE,
    });
    const text = run(["check"]);
    expect(text.exitCode).toBe(1);
    expect(text.stdout).toContain("invalid-type");
    const json = run(["check", "--json"]);
    expect(json.exitCode).toBe(1);
    const parsed = JSON.parse(json.stdout) as { ok: boolean; issues: unknown[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(json.stdout).not.toContain("changeme");
  });

  it("fails on empty values only with --fail-on-empty", () => {
    inTempDir({
      ".env": GOOD.replace("JWT_SECRET=some-real-secret", "JWT_SECRET="),
      ".env.example": EXAMPLE,
    });
    expect(run(["check"]).exitCode).toBe(0);
    expect(run(["check", "--fail-on-empty"]).exitCode).toBe(1);
  });

  it("exits 1 with a clear error when a file is missing", () => {
    inTempDir({ ".env": GOOD });
    const result = run(["check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("example file not found");
  });

  it("init generates a redacted example and schema, and refuses to overwrite", () => {
    const dir = inTempDir({ ".env": GOOD });
    const first = run(["init"]);
    expect(first.exitCode).toBe(0);
    const example = readFileSync(join(dir, ".env.example"), "utf8");
    expect(example).toContain("PORT=");
    expect(example).not.toContain("some-real-secret");
    expect(example).not.toContain("https://db.example.com/app");
    const schema = JSON.parse(readFileSync(join(dir, "env.schema.json"), "utf8")) as Record<string, { type: string }>;
    expect(schema.PORT?.type).toBe("port");
    expect(run(["init"]).exitCode).toBe(1);
    expect(run(["init", "--force"]).exitCode).toBe(0);
  });

  it("diff reports differing keys only, never values", () => {
    inTempDir({ "a.env": "A=1\nB=2\n", "b.env": "A=1\nB=changed\nC=3\n" });
    const result = run(["diff", "a.env", "b.env"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("B");
    expect(result.stdout).toContain("C");
    expect(result.stdout).not.toContain("changed");
    const same = run(["diff", "a.env", "a.env"]);
    expect(same.exitCode).toBe(0);
    expect(same.stdout).toContain("identical");
  });

  it("answers --help and --version", () => {
    expect(run(["--help"]).exitCode).toBe(0);
    expect(run(["--help"]).stdout).toContain("dotenv-doctor");
    expect(run(["--version"]).stdout).toMatch(/dotenv-doctor \d+\.\d+\.\d+/);
  });
});
