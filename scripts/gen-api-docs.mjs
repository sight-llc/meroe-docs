#!/usr/bin/env node
/**
 * gen-api-docs.mjs
 *
 * Fetches the OpenAPI spec from OPENAPI_SPEC_URL and writes one MDX page per
 * developer-facing operation into content/docs/api-reference/, plus writes
 * public/api-spec.json for the in-page API playground.
 *
 * Usage:
 *   OPENAPI_SPEC_URL=https://api.meroe.dev/v3/api-docs node scripts/gen-api-docs.mjs
 *   node scripts/gen-api-docs.mjs ./api-docs.json        (local file)
 *
 * Do NOT hand-edit files under content/docs/api-reference/ — they are
 * overwritten on every run. Put explanatory content in concepts/ or guides/.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

// ─── .env loader ─────────────────────────────────────────────────────────────
// next dev/build auto-load .env.local, but this script runs before Next.js
// starts (via predev/prebuild hooks), so we load env files ourselves.
async function loadEnvFile(filename) {
  try {
    const raw = await fs.readFile(path.resolve(filename), 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch { /* file missing — fine */ }
}
await loadEnvFile('.env.local')
await loadEnvFile('.env')

// ─── Config ───────────────────────────────────────────────────────────────────
const OUT_DIR = path.resolve('content/docs/api-reference')
const SOURCE  = process.argv[2] || process.env.OPENAPI_SPEC_URL

if (!SOURCE) {
  console.error('Usage: OPENAPI_SPEC_URL=<url> node scripts/gen-api-docs.mjs')
  console.error('   or: node scripts/gen-api-docs.mjs <path-to-spec.json>')
  process.exit(1)
}

// ─── Exclusion rules ──────────────────────────────────────────────────────────
// register     — one-time onboarding via app.meroe.dev, not an integration call
// /v1/admin/   — internal admin console (trailing slash prevents false matches)
// x-internal   — escape hatch for any op the backend wants to hide
const EXCLUDED_OPERATION_IDS  = new Set(['register'])
const EXCLUDED_PATH_PREFIXES  = ['/v1/admin/', '/admin/']

function isExcluded(opPath, operation) {
  if (operation['x-internal'] === true) return true
  if (EXCLUDED_OPERATION_IDS.has(operation.operationId)) return true
  if (EXCLUDED_PATH_PREFIXES.some((p) => opPath.startsWith(p))) return true
  return false
}

// ─── Spec loading ─────────────────────────────────────────────────────────────
async function loadSpec(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`)
    return res.json()
  }
  return JSON.parse(await fs.readFile(source, 'utf-8'))
}

// ─── Base URL resolution ──────────────────────────────────────────────────────
// NEXT_PUBLIC_API_BASE_URL wins. Otherwise use the spec's server URL — but
// never use a localhost URL in generated docs (springdoc defaults to localhost).
function resolveBaseUrl(spec) {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '')
  const specUrl = spec.servers?.[0]?.url || ''
  if (specUrl && !specUrl.includes('localhost') && !specUrl.includes('127.0.0.1')) return specUrl.replace(/\/$/, '')
  return 'https://api.meroe.dev'
}

// ─── Slug ─────────────────────────────────────────────────────────────────────
// Always method+path — guaranteed unique by the OpenAPI spec itself.
// operationId is kept only in TryItButton for playground lookup.
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
function operationSlug(method, opPath) {
  return slugify(`${method}-${opPath}`)
}

// ─── $ref resolution ─────────────────────────────────────────────────────────
function resolveRef(schema, spec) {
  if (!schema) return {}
  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, '').split('/')
    return parts.reduce((acc, key) => acc?.[key], spec) ?? {}
  }
  return schema
}

// ─── Type display ─────────────────────────────────────────────────────────────
function displayType(rawSchema, spec) {
  if (!rawSchema) return 'any'
  if (rawSchema.$ref) {
    const resolved = resolveRef(rawSchema, spec)
    // If it has properties, it's an expandable object — show the schema name
    if (resolved.properties) return rawSchema.$ref.split('/').pop()
    return resolved.type || rawSchema.$ref.split('/').pop()
  }
  if (rawSchema.type === 'array') {
    const items = rawSchema.items || {}
    if (items.$ref) {
      const resolvedItem = resolveRef(items, spec)
      if (resolvedItem.properties) return `${items.$ref.split('/').pop()}[]`
      return `${resolvedItem.type || 'object'}[]`
    }
    return `${items.type || 'object'}[]`
  }
  if (rawSchema.additionalProperties !== undefined) return 'object'
  let t = rawSchema.type || 'any'
  if (rawSchema.format) t = `${t}<${rawSchema.format}>`
  return t
}

// ─── Constraint hints ─────────────────────────────────────────────────────────
// Appended to descriptions so developers see validation rules inline.
function constraintHints(schema = {}) {
  const h = []
  if (schema.minLength != null && schema.maxLength != null) h.push(`${schema.minLength}–${schema.maxLength} chars`)
  else if (schema.minLength != null) h.push(`min ${schema.minLength} chars`)
  else if (schema.maxLength != null) h.push(`max ${schema.maxLength} chars`)
  if (schema.pattern)  h.push(`pattern: \`${schema.pattern}\``)
  if (schema.minimum  != null) h.push(`min: ${schema.minimum}`)
  if (schema.maximum  != null) h.push(`max: ${schema.maximum}`)
  if (schema.minItems != null) h.push(`min ${schema.minItems} items`)
  if (schema.maxItems != null) h.push(`max ${schema.maxItems} items`)
  if (schema.format && !['date-time','uuid','int32','int64'].includes(schema.format)) h.push(`format: ${schema.format}`)
  return h.length ? ` _(${h.join(', ')})_` : ''
}

// ─── Body params (request) ────────────────────────────────────────────────────
function renderBodyFields(properties, spec, required = new Set(), indent = '') {
  return Object.entries(properties)
    .map(([name, rawSchema]) => {
      const resolved = resolveRef(rawSchema, spec)
      const req = required.has(name) ? ' required' : ''
      const type = displayType(rawSchema, spec)
      const desc = (rawSchema.description || resolved.description || name).replace(/\n/g, ' ')
      const hints = constraintHints(rawSchema.$ref ? resolved : rawSchema)

      // additionalProperties — free-form map, no nested expansion
      if (rawSchema.additionalProperties !== undefined || resolved.additionalProperties !== undefined) {
        return `${indent}<ParamField body="${name}" type="map<string, any>"${req}>\n${indent}  ${desc}${hints}\n${indent}</ParamField>`
      }

      // array of primitives — show type, no expansion
      if ((rawSchema.type === 'array' || resolved.type === 'array')) {
        const items = rawSchema.items || resolved.items || {}
        const resolvedItems = resolveRef(items, spec)
        if (!resolvedItems.properties) {
          return `${indent}<ParamField body="${name}" type="${type}"${req}>\n${indent}  ${desc}${hints}\n${indent}</ParamField>`
        }
        // array of objects — expand
        const nested = renderBodyFields(resolvedItems.properties, spec, new Set(resolvedItems.required || []), indent + '  ')
        return `${indent}<ParamField body="${name}" type="${type}"${req}>\n${indent}  ${desc}\n${indent}  <Expandable>\n${nested}\n${indent}  </Expandable>\n${indent}</ParamField>`
      }

      // nested object via $ref or inline properties
      const nestedProps = resolved.properties
      if (nestedProps) {
        const nested = renderBodyFields(nestedProps, spec, new Set(resolved.required || []), indent + '  ')
        return `${indent}<ParamField body="${name}" type="${type}"${req}>\n${indent}  ${desc}\n${indent}  <Expandable>\n${nested}\n${indent}  </Expandable>\n${indent}</ParamField>`
      }

      return `${indent}<ParamField body="${name}" type="${type}"${req}>\n${indent}  ${desc}${hints}\n${indent}</ParamField>`
    })
    .join('\n')
}

function bodyFieldsFor(requestBody, spec) {
  const schema = requestBody?.content?.['application/json']?.schema
  if (!schema) return ''
  const resolved = resolveRef(schema, spec)
  const props = resolved.properties || {}
  if (!Object.keys(props).length) return ''
  const required = new Set(resolved.required || [])
  return renderBodyFields(props, spec, required)
}

// ─── Path/query params ────────────────────────────────────────────────────────
function paramFieldsFor(parameters = []) {
  return parameters
    .map((p) => {
      const loc = { path: 'path', query: 'query', header: 'header' }[p.in] || 'query'
      const type = displayType(p.schema || {}, {})
      const req = p.required ? ' required' : ''
      const desc = (p.description || p.name).replace(/\n/g, ' ')
      const hints = constraintHints(p.schema || {})
      return `<ParamField ${loc}="${p.name}" type="${type}"${req}>\n  ${desc}${hints}\n</ParamField>`
    })
    .join('\n')
}

// ─── Response fields ──────────────────────────────────────────────────────────
function renderResponseFields(properties, spec, required = [], indent = '') {
  return Object.entries(properties)
    .map(([name, rawSchema]) => {
      const resolved = resolveRef(rawSchema, spec)
      const req = required.includes(name) ? ' required' : ''
      const type = displayType(rawSchema, spec)
      const desc = (rawSchema.description || resolved.description || '').replace(/\n/g, ' ')
      const hints = constraintHints(rawSchema.$ref ? resolved : rawSchema)

      // additionalProperties — free-form map
      if (rawSchema.additionalProperties !== undefined || resolved.additionalProperties !== undefined) {
        return `${indent}<ResponseField name="${name}" type="map<string, any>"${req}>\n${indent}  ${desc}\n${indent}</ResponseField>`
      }

      // array — check if items are objects (expandable) or primitives
      if (rawSchema.type === 'array' || resolved.type === 'array') {
        const items = rawSchema.items || resolved.items || {}
        const resolvedItems = resolveRef(items, spec)
        if (resolvedItems.properties) {
          const nested = renderResponseFields(resolvedItems.properties, spec, resolvedItems.required || [], indent + '  ')
          return `${indent}<ResponseField name="${name}" type="${type}"${req}>\n${indent}  ${desc}${hints}\n${indent}  <Expandable>\n${nested}\n${indent}  </Expandable>\n${indent}</ResponseField>`
        }
        // primitive array
        return `${indent}<ResponseField name="${name}" type="${type}"${req}>\n${indent}  ${desc}${hints}\n${indent}</ResponseField>`
      }

      // nested object
      if (resolved.properties) {
        const nested = renderResponseFields(resolved.properties, spec, resolved.required || [], indent + '  ')
        return `${indent}<ResponseField name="${name}" type="${type}"${req}>\n${indent}  ${desc}\n${indent}  <Expandable>\n${nested}\n${indent}  </Expandable>\n${indent}</ResponseField>`
      }

      return `${indent}<ResponseField name="${name}" type="${type}"${req}>\n${indent}  ${desc}${hints}\n${indent}</ResponseField>`
    })
    .join('\n')
}

// ─── Response section ─────────────────────────────────────────────────────────
// 2xx responses get full field expansion. 4xx/5xx are grouped into a compact
// error table — they all share ProblemResponse / ValidationProblemResponse and
// expanding them on every page is redundant noise.
function responseSection(responses = {}, spec) {
  const successEntries = Object.entries(responses).filter(([s]) => s.startsWith('2'))
  const errorEntries   = Object.entries(responses).filter(([s]) => s.startsWith('4') || s.startsWith('5'))

  const parts = []

  for (const [status, response] of successEntries) {
    const schema   = response.content?.['application/json']?.schema
    const resolved = schema ? resolveRef(schema, spec) : null
    const desc     = (response.description || '').replace(/\n/g, ' ')

    // 204 No Content or schema with no properties
    if (!resolved?.properties) {
      parts.push(`**${status}** — ${desc}`)
      continue
    }

    const fields = renderResponseFields(resolved.properties, spec, resolved.required || [])
    parts.push(`**${status}** — ${desc}\n\n${fields}`)
  }

  if (errorEntries.length) {
    const rows = errorEntries.map(([status, r]) => {
      const desc = (r.description || '').replace(/\n/g, ' ')
      // Detect ValidationProblemResponse vs ProblemResponse from $ref
      const schema = r.content?.['application/json']?.schema
      const schemaName = schema?.$ref?.split('/').pop() || ''
      const note = schemaName === 'ValidationProblemResponse'
        ? 'See `errors[]` for field-level details'
        : desc
      return `| \`${status}\` | ${note} |`
    })
    parts.push(`## Error Responses\n\n| Status | Detail |\n|---|---|\n${rows.join('\n')}\n\nAll errors follow [RFC 7807 Problem Details](/docs/errors). See the [Errors reference](/docs/errors) for the full schema.`)
  }

  return parts.join('\n\n')
}

// ─── Curl example ─────────────────────────────────────────────────────────────
function buildExampleBody(requestBody, spec) {
  const schema = requestBody?.content?.['application/json']?.schema
  if (!schema) return null
  const resolved = resolveRef(schema, spec)
  const obj = {}
  for (const [key, propSchema] of Object.entries(resolved.properties || {})) {
    const rs = resolveRef(propSchema, spec)
    if (propSchema.example !== undefined) obj[key] = propSchema.example
    else if (rs.example    !== undefined) obj[key] = rs.example
    else if (propSchema.enum?.length)     obj[key] = propSchema.enum[0]
    else if (propSchema.additionalProperties !== undefined) obj[key] = { key: 'value' }
    else if (propSchema.type === 'array')  obj[key] = propSchema.items?.example ? [propSchema.items.example] : []
    else if (propSchema.type === 'boolean') obj[key] = false
    else if (propSchema.type === 'integer' || propSchema.type === 'number') obj[key] = 0
    else obj[key] = ''
  }
  return Object.keys(obj).length ? obj : null
}

function buildUrl(baseUrl, opPath) {
  const base     = baseUrl.replace(/\/$/, '')
  try {
    const basePath = new URL(base).pathname.replace(/\/$/, '')
    const cleanPath = basePath && opPath.startsWith(basePath + '/')
      ? opPath.slice(basePath.length)
      : opPath
    return base + cleanPath
  } catch {
    return base + opPath
  }
}

function curlExample(method, opPath, baseUrl, parameters = [], requestBody, spec) {
  let resolvedPath = opPath
  for (const p of (parameters || []).filter((p) => p.in === 'path')) {
    const ex = p.schema?.example != null ? String(p.schema.example) : `{${p.name}}`
    resolvedPath = resolvedPath.replace(`{${p.name}}`, ex)
  }

  const queryParams = (parameters || []).filter((p) => p.in === 'query' && p.schema?.example != null)
  const qs = queryParams.map((p) => `${p.name}=${p.schema.example}`).join('&')
  const fullUrl = buildUrl(baseUrl, resolvedPath) + (qs ? `?${qs}` : '')

  const noAuth = ['login', 'refresh'].includes((requestBody && '') || '') // login/refresh don't need auth header
  const lines = [`curl -X ${method.toUpperCase()} ${fullUrl} \\`]

  // login and refresh endpoints don't take an API key
  const opId = ''  // placeholder — auth check is below via opPath
  const isAuthEndpoint = opPath.includes('/auth/login') || opPath.includes('/auth/refresh')
  if (!isAuthEndpoint) lines.push(`  -H "Authorization: Bearer mr_test_sk_..." \\`)

  if (requestBody) {
    const exBody = buildExampleBody(requestBody, spec)
    lines.push(`  -H "Content-Type: application/json" \\`)
    lines.push(`  -d '${JSON.stringify(exBody ?? {}, null, 2).replace(/\n/g, '\n  ')}'`)
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '')
  }
  return lines.join('\n')
}

// ─── MDX escaping helpers ─────────────────────────────────────────────────────
// Curly braces in MDX text (both frontmatter and body) must be escaped so the
// MDX compiler does not interpret them as JavaScript expressions.
// HTML entities (&#123; / &#125;) are safe for YAML frontmatter strings and
// render as { and } in the browser without being evaluated as JS.
function escapeMdxBraces(str) {
  return str.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

// ─── MDX page builder ─────────────────────────────────────────────────────────
function buildMdx({ method, opPath, operation, spec, baseUrl }) {
  const title       = escapeMdxBraces(operation.summary || `${method.toUpperCase()} ${opPath}`)
  const description = escapeMdxBraces((operation.description || operation.summary || '').replace(/\n/g, ' '))
  const pathQueryParams = paramFieldsFor(operation.parameters || [])
  const bodyParams  = bodyFieldsFor(operation.requestBody, spec)
  const hasParams   = pathQueryParams || bodyParams
  const responses   = responseSection(operation.responses || {}, spec)
  const example     = curlExample(method, opPath, baseUrl, operation.parameters, operation.requestBody, spec)
  const operationId = operation.operationId || operationSlug(method, opPath)

  return `---
title: "${title.replace(/"/g, "'")}"
description: "${description.replace(/"/g, "'")}"
---

<TryItButton operationId="${operationId}" method="${method.toUpperCase()}" path="${opPath}" />

${description}
${hasParams ? `
## Parameters

${pathQueryParams}
${bodyParams}` : ''}

## Response

${responses}

## Example

<RequestExample>
<CodeGroup>
\`\`\`bash
${example}
\`\`\`
</CodeGroup>
</RequestExample>
`
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Loading spec from ${SOURCE}...`)
  const spec    = await loadSpec(SOURCE)
  const baseUrl = resolveBaseUrl(spec)
  console.log(`  base URL: ${baseUrl}${spec.servers?.[0]?.url?.includes('localhost') ? ' (overriding localhost from spec)' : ''}`)

  // Write filtered spec to public/ for the API playground
  await fs.mkdir(path.resolve('public'), { recursive: true })
  const filteredPaths = {}
  for (const [opPath, methods] of Object.entries(spec.paths || {})) {
    const kept = {}
    for (const [method, op] of Object.entries(methods)) {
      if (!isExcluded(opPath, op)) kept[method] = op
    }
    if (Object.keys(kept).length) filteredPaths[opPath] = kept
  }
  const filteredSpec = { ...spec, paths: filteredPaths }
  await fs.writeFile(path.resolve('public/api-spec.json'), JSON.stringify(filteredSpec, null, 2), 'utf-8')
  console.log(`  wrote public/api-spec.json (${Object.keys(filteredPaths).length} paths — powers the API playground)`)

  // Clean previous MDX output (keep index.mdx)
  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const file of await fs.readdir(OUT_DIR)) {
    if (file === 'index.mdx') continue
    await fs.rm(path.join(OUT_DIR, file), { recursive: true, force: true })
  }

  const pages  = ['index']
  const byTag  = new Map()
  let skipped  = 0
  let generated = 0

  for (const [opPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue

      if (isExcluded(opPath, operation)) {
        skipped++
        const reason = operation.operationId === 'register'
          ? 'register — onboarding is via dashboard'
          : 'admin'
        console.log(`  skipped  ${method.toUpperCase().padEnd(7)} ${opPath} (${reason})`)
        continue
      }

      const slug = operationSlug(method, opPath)
      const mdx  = buildMdx({ method, opPath, operation, spec, baseUrl })
      await fs.writeFile(path.join(OUT_DIR, `${slug}.mdx`), mdx, 'utf-8')

      const tag = operation.tags?.[0] || 'Other'
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag).push(slug)

      generated++
      console.log(`  wrote    ${method.toUpperCase().padEnd(7)} ${opPath} → ${slug}.mdx`)
    }
  }

  for (const [tag, slugs] of byTag) {
    pages.push(`---${tag}---`)
    pages.push(...slugs)
  }

  await fs.writeFile(
    path.join(OUT_DIR, 'meta.json'),
    JSON.stringify({ title: 'API Reference', pages }, null, 2),
    'utf-8'
  )

  console.log(`\nDone. Generated ${generated} pages across ${byTag.size} tag(s). Skipped ${skipped}.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
