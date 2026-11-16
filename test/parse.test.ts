import { describe, expect, it } from "vitest";
import { inferRule, isSecretKey, parseEnv } from "../src/parse.js";

describe("parseEnv", () => {
  it("parses KEY=value lines with file and line numbers", () => {
    const result = parseEnv("PORT=3000\n# comment\nDEBUG=true\n", ".env");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ key: "PORT", value: "3000", line: 1, file: ".env" });
    expect(result.entries[1]).toMatchObject({ key: "DEBUG", value: "true", line: 3 });
    expect(result.byKey.get("PORT")?.value).toBe("3000");
  });

  it("handles export prefix, empty values and quotes", () => {
    const result = parseEnv('export A=1\nB=\nC="hello world"\nD=\'single\'\n', ".env");
    expect(result.byKey.get("A")?.value).toBe("1");
    expect(result.byKey.get("B")?.value).toBe("");
    expect(result.byKey.get("C")?.value).toBe("hello world");
    expect(result.byKey.get("C")?.quoted).toBe(true);
    expect(result.byKey.get("D")?.value).toBe("single");
  });

  it("keeps # inside quotes and strips trailing comments", () => {
    const result = parseEnv('A="a#b" # note\nB=plain # trailing\n', ".env");
    expect(result.byKey.get("A")?.value).toBe("a#b");
    expect(result.byKey.get("A")?.comment).toBe("note");
    expect(result.byKey.get("B")?.value).toBe("plain");
    expect(result.byKey.get("B")?.comment).toBe("trailing");
  });

  it("reports duplicate keys and malformed lines", () => {
    const result = parseEnv("A=1\nA=2\nnot an assignment\n", ".env");
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.line).toBe(2);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]?.line).toBe(3);
  });

  it("detects secret-looking keys and infers rules", () => {
    expect(isSecretKey("JWT_SECRET")).toBe(true);
    expect(isSecretKey("API_TOKEN")).toBe(true);
    expect(isSecretKey("PORT")).toBe(false);
    expect(inferRule("PORT", "3000").type).toBe("port");
    expect(inferRule("DATABASE_URL", "https://example.com").type).toBe("url");
    expect(inferRule("DEBUG", "true").type).toBe("boolean");
  });
});
