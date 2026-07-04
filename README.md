# Meroe Docs

Developer documentation for Meroe, built on [Unmint](https://github.com/gregce/unmint) (Next.js + Fumadocs, Mintlify-style).

This site is the **developer-facing** reference — for teams integrating with Meroe's virtual account API. It explains *why* and *how*, not just endpoint shapes. For the raw interactive endpoint console, see Swagger UI at `/v1/docs` on the API itself.

## Structure

```
content/docs/
├── index.mdx                 # Homepage
├── getting-started.mdx       # 15-minute happy-path walkthrough
├── concepts/                 # Why things work the way they do
│   ├── virtual-accounts.mdx
│   ├── reconciliation.mdx    # The core differentiator — read this first
│   ├── ledger.mdx
│   ├── webhooks.mdx
│   └── kyc-tiers.mdx
├── guides/                   # Task-oriented walkthroughs
│   ├── authentication.mdx
│   ├── sandbox.mdx
│   ├── misdirected.mdx
│   ├── lifecycle.mdx
│   └── statements.mdx
├── api-reference/            # AUTO-GENERATED — do not hand-edit
│   ├── index.mdx             # (hand-maintained — survives regeneration)
│   └── ...                   # one MDX page per endpoint
├── errors.mdx
├── sdk.mdx
└── changelog.mdx
```

## Local development

```bash
npm install
cp .env.example .env.local   # set OPENAPI_SPEC_URL
npm run dev
```

Open http://localhost:3000.

## Regenerating the API reference

Unlike Docusaurus, Unmint has no built-in OpenAPI plugin — `scripts/gen-api-docs.mjs` is our equivalent. It:

- Fetches the spec from `OPENAPI_SPEC_URL` (or accepts a local file path as an arg)
- Writes one MDX page per operation into `content/docs/api-reference/`, using Unmint's built-in `ParamField` / `ResponseField` / `CodeGroup` components
- **Excludes `/v1/admin/**` and `/v1/developer/**` automatically** — this site documents core infrastructure endpoints integrators call (customers, accounts, reconciliation, statements, webhooks, sandbox), not the admin console or the endpoints that only exist to render `app.meroe.dev`'s own dashboard (stats/charts, request logs, business profile, KYC upload, key management). See `EXCLUDED_PATH_PREFIXES` / `EXCLUDED_TAGS` in the script if that boundary ever needs to change.
- Regenerates `api-reference/meta.json` (sidebar order), grouped by OpenAPI tag
- Never touches `api-reference/index.mdx` — that page is hand-maintained

```bash
npm run gen-api
```

This also runs automatically before `dev` and `build` (`predev` / `prebuild` in `package.json`), and fails *gracefully* if the spec is unreachable — it logs a warning and falls back to whatever's already generated, rather than blocking your build.

**Do not hand-edit files under `api-reference/`** (other than `index.mdx`) — `gen-api` deletes and rewrites that whole folder on every run. Put explanatory content in `concepts/` or `guides/` and link to the relevant endpoint instead.

## Deploying

Netlify / Vercel both auto-detect Next.js.

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = ".next"
```

Set `OPENAPI_SPEC_URL` as a build environment variable so `prebuild` pulls the live spec on every deploy.
