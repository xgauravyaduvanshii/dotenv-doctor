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
- **Multi-env support** — `check --env staging` validates `.env.staging` against `.env.example`, with per-env schema overrides from the schema file's `envs` map or a dedicated `env.schema.staging.json`.
- **`fix`** — add missing keys with safe placeholder values (typed keys get a type-valid placeholder, secrets get `CHANGE_ME`), backing the original up to `.env.bak` first.
- **`export`** — print the validated config as JSON or YAML, values redacted by default (`--include-values` prints them, with a stderr warning).
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

### Multi-env — `check --env <name>`

```bash
dotenv-doctor check --env staging            # .env.staging vs .env.example
dotenv-doctor check --env production --strict
```

`--env staging` loads `.env.staging` instead of `.env`, and applies per-env schema overrides — first from the `envs` map in `env.schema.json`, then from a dedicated `env.schema.staging.json` file when you use the default schema location. For example, `NODE_ENV=staging` fails the base enum (`development,test,production`) but passes with a staging override that allows `staging`. See [Configuration](#configuration) and [`examples/env.schema.json`](examples/env.schema.json).

### `fix` — add missing keys with safe placeholders

```bash
dotenv-doctor fix                            # add missing keys to .env
dotenv-doctor fix --env staging              # add missing keys to .env.staging
dotenv-doctor fix --force                    # overwrite an existing .env.bak
```

Adds every key that is in `.env.example` but missing from your `.env`, with a safe placeholder: typed keys get a type-valid value (`PORT=3000`, `DATABASE_URL=https://example.com`, `DEBUG=false`, `NODE_ENV=<first enum value>`), secret and string keys get `CHANGE_ME` — which `check` flags as a placeholder until you replace it with a real secret. The original file is backed up to `.env.bak` first; if a backup already exists, `fix` refuses unless you pass `--force`. If the env file does not exist, `fix` creates it. `fix` never writes a real secret — it only scaffolds placeholders you must replace.

### `export` — print the validated config as JSON or YAML

```bash
dotenv-doctor export                         # JSON, values redacted
dotenv-doctor export --format yaml           # YAML, values redacted
dotenv-doctor export --env staging --format yaml
dotenv-doctor export --include-values        # prints real values + a stderr warning
```

Exports the keys from `.env.example` with their type and value. Values are `"<redacted>"` by default — safe to paste into a ticket or a log. `--include-values` prints the real values and a warning on stderr; never share that output. `export` runs validation first and prints nothing (exit `1`) when the config has errors — fix it, then export.

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

### Per-environment overrides

Two ways, both optional — the base rules above still apply unless overridden:

```json
{
  "NODE_ENV": { "type": "enum", "enum": ["development", "test", "production"] },
  "envs": {
    "staging": { "NODE_ENV": { "type": "enum", "enum": ["staging", "production"] } },
    "production": { "NODE_ENV": { "type": "enum", "enum": ["production"] } }
  }
}
```

Or a dedicated file next to it: `env.schema.staging.json` (applied only when you use the default schema location, i.e. without `--schema`). Per-key rules are merged — an override only replaces the fields it sets, and JSON schema rules still win over inline comments.

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

# Multi-env: passes with the staging override, fails without it
dotenv-doctor check --env staging examples/.env.staging examples/.env.example --schema examples/env.schema.json
dotenv-doctor check --env staging examples/.env.staging examples/.env.example

# Fix a partial file, then export the validated config (values redacted)
dotenv-doctor fix
dotenv-doctor export --format yaml
```

## Changelog

### 0.2.0

- **Multi-env support** — `check --env staging|production` loads `.env.<env>` against `.env.example`, with per-env schema overrides from the schema file's `envs` map or a dedicated `env.schema.<env>.json`.
- **`fix` command** — adds missing keys with safe placeholders (typed keys get type-valid values, secrets get `CHANGE_ME`), backs the original up to `.env.bak`, refuses to overwrite an existing backup without `--force`.
- **`export` command** — prints the validated config as JSON (default) or YAML; values are `"<redacted>"` unless `--include-values` is passed, which warns on stderr. Export fails with no output when validation finds errors.

### 0.1.0

- Initial release — `check`, `init`, `diff`, type validation from `env.schema.json` or inline comments, secret-shape warnings, CI mode (`--strict`, `--fail-on-empty`, `--json`).

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
