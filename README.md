# dotenv-doctor

**Fail-fast `.env` checker for Node.js projects — catch missing, empty, mistyped and placeholder environment variables before deploy, not after.**

`dotenv-doctor` compares your `.env` file against `.env.example`, validates value types, and warns about secret-shaped values — without ever printing a secret value in its output, so it is safe to run in CI logs.

```bash
npx dotenv-doctor check
# dotenv-doctor: .env vs .env.example
# ERROR [invalid-type] .env:1 Key PORT is not a valid port (integer 1-65535).
# ERROR [missing] .env Key DATABASE_URL is missing …
# 2 error(s), 1 warning(s) — 8 key(s) checked, 1 missing, 0 empty, 0 extra.
```

## Why this exists

A missing `DATABASE_URL` or a `PORT=abc` usually surfaces at 2 a.m. in production, as a crash with no useful message. `dotenv-doctor` turns that into a one-second local check and a CI gate that fails the build before the bad config ships.

Honest note: this problem is not new. [`dotenv-safe`](https://github.com/rolodato/dotenv-safe) and [`envalid`](https://github.com/af/envalid) already solve parts of it well — `dotenv-safe` validates a `.env` against a sample file at load time, and `envalid` validates and types environment variables inside your code. `dotenv-doctor` is a different shape of the same idea: a standalone, zero-runtime-dependency CLI you run as a pre-deploy check, with secret-shape warnings, a `diff` command, an `init` generator, and `--json` output for CI. If you already use `dotenv-safe` or `envalid` in your app, you probably do not need this too.

## Features

- **Check** `.env` against `.env.example` — missing, empty and extra keys, each with file and line number.
- **Type validation** — `port`, `url`, `boolean`, `number`, `email`, `enum`, `regex` — from `env.schema.json` or inline comments (`# @type port`, `# @enum development,test,production`).
- **Secret-shape warnings** — leading/trailing whitespace, surrounding quotes, and placeholder values on secret-looking keys (`*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `API_KEY`, …). Values are never printed, in text or JSON output.
- **`init`** — generate a redacted `.env.example` and `env.schema.json` from an existing `.env` (values are never copied).
- **`diff`** — compare two env files by key name only; differing values are reported by key, never shown.
- **CI mode** — `--strict` (warnings fail the build), `--fail-on-empty`, `--json`, exit code `0` on success and `1` on any error.
- **Zero runtime dependencies**, Node.js 18+, TypeScript.

## Install

```bash
npm install -g dotenv-doctor
# or, per project:
npm install --save-dev dotenv-doctor
```

Requires Node.js 18 or later.

## Usage

### `check` — validate a `.env` file

```bash
dotenv-doctor check                          # .env vs .env.example
dotenv-doctor check .env.production .env.example
dotenv-doctor check --schema env.schema.json --strict --fail-on-empty --json
```

Exit code is `0` when there are no errors and `1` otherwise. By default an empty value is a warning; `--fail-on-empty` (or `--strict`) makes it an error, and `--strict` also makes extra keys and secret-shape warnings fail the build.

### `init` — generate `.env.example` and `env.schema.json`

```bash
dotenv-doctor init
dotenv-doctor init .env.production --out-example .env.example --force
```

Reads your `.env`, writes a redacted example (secret keys become empty, other keys get a `# @type …` comment) and a matching `env.schema.json`. It refuses to overwrite existing files unless you pass `--force`. Your values are never written to either output file.

### `diff` — compare two env files

```bash
dotenv-doctor diff .env.local .env.production
dotenv-doctor diff .env.local .env.production --json
```

Reports keys that exist in only one file and keys whose values differ — by key name only. Exit `0` when the files match, `1` when they differ.

## Configuration

### `env.schema.json`

A JSON object mapping keys to rules. It takes precedence over inline comments.

```json
{
  "PORT": { "type": "port" },
  "DATABASE_URL": { "type": "url" },
  "NODE_ENV": { "type": "enum", "enum": ["development", "test", "production"] },
  "DEBUG": { "type": "boolean" },
  "API_TIMEOUT_MS": { "type": "number" },
  "SUPPORT_EMAIL": { "type": "email" },
  "USERNAME": { "type": "regex", "pattern": "^[a-z0-9_]{3,20}$" }
}
```

Supported types: `port` (integer 1–65535), `url` (http/https), `boolean` (`true`/`false`), `number`, `email`, `enum` (needs an `enum` list), `regex` (needs a `pattern`), `string` (no check).

### Inline comments

If you do not want a schema file, annotate `.env.example` directly:

```dotenv
PORT=3000 # @type port
NODE_ENV=development # @enum development,test,production
DEBUG=false # @type boolean
API_TIMEOUT_MS=5000 # @type number
SUPPORT_EMAIL=support@example.com # @type email
```

`env.schema.json` wins when both are present.

## CI

Add a step that fails the build on bad config:

```yaml
- run: npx dotenv-doctor check --strict --fail-on-empty
```

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the workflow used by this repo, which tests Node 18, 20 and 22 and smoke-tests the built CLI against the fixtures in [`fixtures/`](fixtures/).

## Examples

The [`examples/`](examples/) directory has a working set you can try immediately:

```bash
# Passes (exit 0) — see fixtures/.env.good for a passing file
dotenv-doctor check fixtures/.env.good fixtures/.env.example --schema fixtures/env.schema.json

# Fails (exit 1) — bad port, bad URL, bad enum, bad boolean, placeholder secret, extra key
dotenv-doctor check examples/.env.bad examples/.env.example --schema examples/env.schema.json
```

## How it handles secrets

`dotenv-doctor` parses values in memory to validate them, but its output never contains a value — not in text mode, not in `--json` mode, not in `diff` mode. Findings name the key, the file and the line, and describe the problem in general terms ("is not a valid port", "looks like a placeholder value"). That is deliberate: CI logs get copied, pasted and stored, and a checker must never be the thing that leaks a secret.

## Development

```bash
npm install
npm test        # Vitest
npm run build   # tsc -> dist/
```

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Gaurav Kumar Yadav ([FlyingDarkDev](https://flyingdarkdev.com)).
