'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePlayground } from './context'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenAPISpec {
  servers?: { url: string }[]
  paths: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, Schema> }
}

interface Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string, OAResponse>
}

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'body'
  required?: boolean
  description?: string
  schema?: Schema
}

interface RequestBody {
  content?: { 'application/json'?: { schema?: Schema } }
}

interface OAResponse {
  description?: string
  content?: { 'application/json'?: { schema?: Schema } }
}

interface Schema {
  type?: string
  format?: string
  properties?: Record<string, Schema>
  required?: string[]
  description?: string
  example?: unknown
  enum?: string[]
  items?: Schema
  $ref?: string
}

interface FlatOperation {
  operationId: string
  method: string
  path: string
  summary: string
  tags: string[]
  parameters: Parameter[]
  bodySchema: Schema | null
  bodyRequired: string[]
  successResponse: OAResponse | null
}

interface ApiResponseState {
  status: number
  statusText: string
  data: unknown
  durationMs: number
  error?: string
  isExample?: boolean
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

function resolveRef(schema: Schema | undefined, spec: OpenAPISpec): Schema {
  if (!schema) return {}
  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, '').split('/')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return parts.reduce((acc: any, key) => acc?.[key], spec) ?? {}
  }
  return schema
}

/**
 * Walk a schema and build an example object from field-level `example` values.
 * Falls back to type-based placeholders when no example annotation exists.
 * Handles $ref, nested objects, and arrays.
 */
function buildExample(schema: Schema | undefined, spec: OpenAPISpec, depth = 0): unknown {
  if (!schema || depth > 6) return null
  const resolved = resolveRef(schema, spec)

  // Field has a direct example value — use it
  if (resolved.example !== undefined) return resolved.example

  // Object — recurse into properties
  if (resolved.type === 'object' || resolved.properties) {
    const obj: Record<string, unknown> = {}
    for (const [key, propSchema] of Object.entries(resolved.properties ?? {})) {
      obj[key] = buildExample(propSchema, spec, depth + 1)
    }
    return obj
  }

  // Array — build one example item
  if (resolved.type === 'array' && resolved.items) {
    return [buildExample(resolved.items, spec, depth + 1)]
  }

  // Enum — pick the first value
  if (resolved.enum?.length) return resolved.enum[0]

  // Primitive fallbacks
  switch (resolved.type) {
    case 'string':  return resolved.format === 'date-time' ? '2025-01-01T00:00:00Z' : ''
    case 'integer':
    case 'number':  return 0
    case 'boolean': return false
    default:        return null
  }
}

function getSuccessExample(op: FlatOperation, spec: OpenAPISpec): unknown | null {
  if (!op.successResponse) return null
  const schema = op.successResponse.content?.['application/json']?.schema
  if (!schema) return null
  return buildExample(schema, spec)
}

// ─── Flatten spec ─────────────────────────────────────────────────────────────

function flattenSpec(spec: OpenAPISpec): FlatOperation[] {
  const ops: FlatOperation[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const body = op.requestBody?.content?.['application/json']?.schema
      const resolved = body ? resolveRef(body, spec) : null

      // Find first 2xx response
      const successEntry = Object.entries(op.responses ?? {}).find(([code]) =>
        code.startsWith('2')
      )
      const successResponse = successEntry?.[1] ?? null

      ops.push({
        operationId: op.operationId ?? `${method}-${path}`,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? `${method.toUpperCase()} ${path}`,
        tags: op.tags ?? ['Other'],
        parameters: op.parameters ?? [],
        bodySchema: resolved,
        bodyRequired: resolved?.required ?? [],
        successResponse,
      })
    }
  }
  return ops
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

function methodColor(method: string) {
  switch (method) {
    case 'GET':    return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
    case 'POST':   return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
    case 'PUT':    return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
    case 'PATCH':  return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20'
    case 'DELETE': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
    default:       return 'text-muted-foreground bg-muted'
  }
}

function statusColor(status: number) {
  if (status >= 200 && status < 300) return 'text-emerald-600 dark:text-emerald-400'
  if (status >= 400 && status < 500) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function MethodBadge({ method, small }: { method: string; small?: boolean }) {
  return (
    <span className={cn(
      'font-mono font-bold rounded shrink-0',
      small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
      methodColor(method)
    )}>
      {method}
    </span>
  )
}

// ─── Endpoint sidebar ─────────────────────────────────────────────────────────

function EndpointList({
  operations,
  selectedId,
  onSelect,
}: {
  operations: FlatOperation[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const grouped = operations.reduce<Record<string, FlatOperation[]>>((acc, op) => {
    const tag = op.tags[0] ?? 'Other'
    if (!acc[tag]) acc[tag] = []
    acc[tag].push(op)
    return acc
  }, {})

  return (
    <div className="h-full overflow-y-auto py-2">
      {Object.entries(grouped).map(([tag, ops]) => (
        <div key={tag} className="mb-1">
          <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            {tag}
          </div>
          {ops.map((op) => (
            <button
              key={op.operationId}
              onClick={() => onSelect(op.operationId)}
              className={cn(
                'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors',
                'hover:bg-muted/60',
                selectedId === op.operationId
                  ? 'bg-[var(--accent-muted)] border-r-2 border-[var(--accent)]'
                  : ''
              )}
            >
              <MethodBadge method={op.method} small />
              <span className={cn(
                'text-xs font-mono truncate',
                selectedId === op.operationId
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              )}>
                {op.path}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Param input ──────────────────────────────────────────────────────────────

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: Parameter
  value: string
  onChange: (v: string) => void
}) {
  const isEnum = (param.schema?.enum?.length ?? 0) > 0
  const placeholder = param.schema?.example != null
    ? String(param.schema.example)
    : param.description ?? param.name

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="w-[38%] min-w-0 pt-0.5">
        <div className="flex items-center gap-1 flex-wrap">
          <code className="text-xs font-semibold text-foreground break-all">{param.name}</code>
          {param.required && <span className="text-[10px] text-red-500 font-bold">*</span>}
        </div>
        {param.schema?.type && (
          <span className="text-[10px] text-muted-foreground/70 font-mono">{param.schema.type}</span>
        )}
      </div>
      <div className="flex-1">
        {isEnum ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-muted text-sm text-foreground rounded-md px-2.5 py-1.5 outline-none border border-border focus:border-[var(--accent)] transition-colors"
          >
            <option value="">Select…</option>
            {param.schema!.enum!.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-muted text-sm text-foreground rounded-md px-2.5 py-1.5 outline-none border border-border focus:border-[var(--accent)] placeholder:text-muted-foreground/40 transition-colors font-mono"
          />
        )}
      </div>
    </div>
  )
}

// ─── Response panel ───────────────────────────────────────────────────────────

function ResponsePanel({
  response,
  loading,
}: {
  response: ApiResponseState | null
  loading: boolean
}) {
  const [copied, setCopied] = useState(false)

  const formatted = response?.data != null
    ? typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data, null, 2)
    : ''

  const copy = useCallback(() => {
    if (!formatted) return
    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [formatted])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2 p-8">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="text-sm">Sending request…</span>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-muted-foreground text-center">
          Fill in the parameters above and click <strong>Send</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {response.isExample ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Example response
            </span>
          ) : (
            <>
              <span className={cn('font-mono font-bold text-sm', statusColor(response.status))}>
                {response.status || 'ERR'} {response.statusText}
              </span>
              <span className="text-xs text-muted-foreground">{response.durationMs}ms</span>
            </>
          )}
        </div>
        {formatted && (
          <button
            onClick={copy}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </div>

      {/* Body */}
      <div className={cn(
        'flex-1 rounded-lg overflow-auto border',
        response.isExample ? 'border-border/50 bg-muted/40' : 'border-border bg-muted'
      )}>
        {formatted ? (
          <pre className={cn(
            'p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed',
            response.isExample ? 'text-foreground/70' : 'text-foreground'
          )}>
            {formatted}
          </pre>
        ) : (
          <p className="p-4 text-xs text-muted-foreground italic">No response body.</p>
        )}
      </div>

      {response.isExample && (
        <p className="text-[10px] text-muted-foreground/60 text-center">
          This is the example from the API spec. Send a real request to see a live response.
        </p>
      )}
    </div>
  )
}

// ─── Playground panel ─────────────────────────────────────────────────────────

function PlaygroundPanel({
  op,
  spec,
  baseUrl,
}: {
  op: FlatOperation
  spec: OpenAPISpec
  baseUrl: string
}) {
  const [apiKey, setApiKey]       = useState('')
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [bodyValues, setBodyValues]   = useState<Record<string, string>>({})
  const [response, setResponse]   = useState<ApiResponseState | null>(null)
  const [loading, setLoading]     = useState(false)
  const [activeTab, setActiveTab] = useState<'params' | 'response'>('params')

  // When endpoint changes, reset form and show the spec example
  const opId = op.operationId
  useEffect(() => {
    setParamValues({})
    setBodyValues({})
    setActiveTab('params')

    const example = getSuccessExample(op, spec)
    if (example != null) {
      setResponse({
        status: 200,
        statusText: 'OK',
        data: example,
        durationMs: 0,
        isExample: true,
      })
    } else {
      setResponse(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opId])

  const setParam = (name: string, val: string) =>
    setParamValues((p) => ({ ...p, [name]: val }))
  const setBody = (name: string, val: string) =>
    setBodyValues((p) => ({ ...p, [name]: val }))

  const buildUrl = () => {
    const base = baseUrl.replace(/\/$/, '')
    let opPath = op.path
    try {
      const basePath = new URL(base).pathname.replace(/\/$/, '')
      if (basePath && opPath.startsWith(basePath + '/')) opPath = opPath.slice(basePath.length)
    } catch { /* non-URL baseUrl, leave path as-is */ }
    let url = base + opPath
    op.parameters.filter((p) => p.in === 'path').forEach((p) => {
      url = url.replace(`{${p.name}}`, paramValues[p.name] || `{${p.name}}`)
    })
    const qs = op.parameters
      .filter((p) => p.in === 'query' && paramValues[p.name])
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues[p.name])}`)
      .join('&')
    return qs ? `${url}?${qs}` : url
  }

  const sendRequest = async () => {
    setLoading(true)
    setActiveTab('response')
    const url = buildUrl()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const hasBody = Object.keys(op.bodySchema?.properties ?? {}).length > 0
    const body = hasBody && !['GET', 'HEAD'].includes(op.method)
      ? JSON.stringify(Object.fromEntries(Object.entries(bodyValues).filter(([, v]) => v !== '')))
      : undefined

    const t0 = Date.now()
    try {
      const res = await fetch(url, { method: op.method, headers, body })
      const durationMs = Date.now() - t0
      const ct = res.headers.get('content-type') ?? ''
      const data = ct.includes('application/json') ? await res.json() : await res.text()
      setResponse({ status: res.status, statusText: res.statusText, data, durationMs })
    } catch (err) {
      setResponse({
        status: 0,
        statusText: 'Network Error',
        data: null,
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  const pathParams  = op.parameters.filter((p) => p.in === 'path')
  const queryParams = op.parameters.filter((p) => p.in === 'query')
  const bodyProps   = Object.entries(op.bodySchema?.properties ?? {})
  const hasParams   = pathParams.length > 0 || queryParams.length > 0 || bodyProps.length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* URL + Send bar */}
      <div className="px-4 py-3.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
          <MethodBadge method={op.method} />
          <span className="font-mono text-sm text-foreground truncate flex-1 min-w-0">{buildUrl()}</span>
          <button
            onClick={sendRequest}
            disabled={loading}
            className={cn(
              'ml-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all shrink-0',
              'bg-[var(--accent)] text-white hover:opacity-90 active:scale-95',
              loading && 'opacity-60 cursor-wait'
            )}
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
        </div>
        {op.summary && (
          <p className="text-xs text-muted-foreground mt-1.5 truncate">{op.summary}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 shrink-0">
        {(['params', 'response'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'py-2.5 px-1 mr-5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
              activeTab === tab
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
            {tab === 'response' && response && !response.isExample && (
              <span className={cn('ml-1.5 text-xs font-mono', statusColor(response.status))}>
                {response.status}
              </span>
            )}
            {tab === 'response' && response?.isExample && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">eg</span>
            )}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'params' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Auth */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Authorization
              </p>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border focus-within:border-[var(--accent)] transition-colors">
                <span className="text-xs text-muted-foreground font-mono shrink-0">Bearer</span>
                <input
                  type="password"
                  placeholder="mr_test_sk_…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
                />
              </div>
            </div>

            {/* Path params */}
            {pathParams.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  Path Parameters
                </p>
                {pathParams.map((p) => (
                  <ParamInput key={p.name} param={p} value={paramValues[p.name] ?? ''} onChange={(v) => setParam(p.name, v)} />
                ))}
              </div>
            )}

            {/* Query params */}
            {queryParams.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  Query Parameters
                </p>
                {queryParams.map((p) => (
                  <ParamInput key={p.name} param={p} value={paramValues[p.name] ?? ''} onChange={(v) => setParam(p.name, v)} />
                ))}
              </div>
            )}

            {/* Body */}
            {bodyProps.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                  Request Body
                </p>
                {bodyProps.map(([name, schema]) => (
                  <ParamInput
                    key={name}
                    param={{
                      name,
                      in: 'body',
                      required: op.bodyRequired.includes(name),
                      description: schema.description,
                      schema,
                    }}
                    value={bodyValues[name] ?? ''}
                    onChange={(v) => setBody(name, v)}
                  />
                ))}
              </div>
            )}

            {!hasParams && (
              <p className="text-sm text-muted-foreground py-4">
                This endpoint takes no parameters.
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <ResponsePanel response={response} loading={loading} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

function PlaygroundModalInner() {
  const { isOpen, selectedOperationId, closePlayground, setSelectedOperationId } = usePlayground()
  const [spec, setSpec]           = useState<OpenAPISpec | null>(null)
  const [specError, setSpecError] = useState(false)
  const [operations, setOperations] = useState<FlatOperation[]>([])
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    fetch('/api-spec.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: OpenAPISpec) => {
        setSpec(data)
        setOperations(flattenSpec(data))
      })
      .catch(() => setSpecError(true))
  }, [])

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closePlayground() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [closePlayground])

  if (!isOpen) return null

  const selectedOp = operations.find((o) => o.operationId === selectedOperationId) ?? operations[0] ?? null
  const baseUrl    = spec?.servers?.[0]?.url ?? (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.meroe.dev/v1')

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closePlayground}
        aria-hidden
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal
        aria-label="API Playground"
        className={cn(
          'relative w-full bg-background border border-border shadow-2xl flex flex-col overflow-hidden',
          'h-[92vh] sm:h-[85vh] sm:max-w-5xl',
          'rounded-t-2xl sm:rounded-2xl'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span className="font-semibold text-sm">API Playground</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {baseUrl}
            </span>
          </div>
          <button
            onClick={closePlayground}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {specError ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-medium mb-2">Spec not loaded</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Run <code className="bg-muted px-1 py-0.5 rounded text-[11px]">npm run gen-api</code> with{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-[11px]">OPENAPI_SPEC_URL</code> set.
                The filtered spec is written to{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-[11px]">public/api-spec.json</code>.
              </p>
            </div>
          </div>
        ) : !spec ? (
          <div className="flex-1 flex items-center justify-center">
            <svg className="animate-spin w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Endpoint sidebar — hidden on mobile */}
            <div className="w-52 shrink-0 border-r border-border overflow-hidden hidden sm:flex flex-col">
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 shrink-0">
                Endpoints
              </div>
              <EndpointList
                operations={operations}
                selectedId={selectedOp?.operationId ?? null}
                onSelect={setSelectedOperationId}
              />
            </div>

            {/* Right: playground */}
            <div className="flex-1 overflow-hidden">
              {selectedOp && spec ? (
                <PlaygroundPanel op={selectedOp} spec={spec} baseUrl={baseUrl} />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select an endpoint to get started.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export function PlaygroundModal() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return <PlaygroundModalInner />
}
