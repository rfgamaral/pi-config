import { Buffer } from 'node:buffer'

const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'

/** Normalized provider quota window. */
export type QuotaWindow = {
    label: string
    usedPercent: number
    resetsAt?: number
    model?: string
}

/** Providers with quota adapters. */
export type SupportedQuotaProvider = 'anthropic' | 'openai-codex'

/** Check whether Cockpit can fetch quota data for a provider. */
export function supportsQuotaProvider(provider: string): provider is SupportedQuotaProvider {
    return provider === 'anthropic' || provider === 'openai-codex'
}

/** Convert an unknown value to an object when possible. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : undefined
}

/** Convert an unknown value to a finite number when possible. */
function asFiniteNumber(value: unknown): number | undefined {
    const number =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim()
              ? Number(value)
              : NaN

    return Number.isFinite(number) ? number : undefined
}

/** Parse an ISO string or Unix timestamp into milliseconds. */
function parseTimestamp(value: unknown): number | undefined {
    const number = asFiniteNumber(value)
    const timestamp =
        number !== undefined
            ? number > 100_000_000_000
                ? number
                : number * 1000
            : typeof value === 'string'
              ? Date.parse(value)
              : NaN

    return Number.isFinite(timestamp) ? timestamp : undefined
}

/** Normalize a model name for scoped-window matching. */
function normalizeModelName(value: string): string {
    return value
        .toLowerCase()
        .replace(/\bclaude\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/** Select a model-scoped window in place of its provider-wide equivalent. */
export function quotaWindowsForModel(windows: QuotaWindow[], modelIdentity: string): QuotaWindow[] {
    const identity = normalizeModelName(modelIdentity)
    const scoped = windows.find((window) => {
        const model = window.model ? normalizeModelName(window.model) : ''

        return model.length > 0 && identity.includes(model)
    })

    if (!scoped) {
        return windows.filter((window) => !window.model)
    }

    return [...windows.filter((window) => !window.model && window.label !== scoped.label), scoped]
}

/** Normalize one Anthropic usage window. */
function parseAnthropicWindow(
    label: string,
    value: unknown,
    model?: string,
): QuotaWindow | undefined {
    const window = asRecord(value)
    const usedPercent = asFiniteNumber(window?.utilization)

    if (usedPercent === undefined) {
        return undefined
    }

    return {
        label,
        usedPercent,
        resetsAt: parseTimestamp(window?.resets_at),
        ...(model ? { model } : {}),
    }
}

/** Normalize Anthropic's provider-wide and model-scoped usage windows. */
function parseAnthropicUsage(value: unknown): QuotaWindow[] {
    const data = asRecord(value)

    if (
        !data ||
        (!('five_hour' in data) && !('seven_day' in data) && !Array.isArray(data.limits))
    ) {
        throw new Error('Malformed Anthropic quota response')
    }

    const windows: QuotaWindow[] = []
    const fiveHour = parseAnthropicWindow('5h', data.five_hour)
    const sevenDay = parseAnthropicWindow('7d', data.seven_day)

    if (fiveHour) windows.push(fiveHour)
    if (sevenDay) windows.push(sevenDay)

    const scopedModels = new Set<string>()

    for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith('seven_day_')) {
            continue
        }

        const model = key.slice('seven_day_'.length).replaceAll('_', ' ')
        const window = parseAnthropicWindow('7d', value, model)

        if (window) {
            windows.push(window)
            scopedModels.add(normalizeModelName(model))
        }
    }

    for (const value of Array.isArray(data.limits) ? data.limits : []) {
        const limit = asRecord(value)
        const scope = asRecord(limit?.scope)
        const model = asRecord(scope?.model)
        const displayName = model?.display_name
        const usedPercent = asFiniteNumber(limit?.percent)

        if (
            limit?.kind !== 'weekly_scoped' ||
            typeof displayName !== 'string' ||
            !displayName.trim() ||
            usedPercent === undefined ||
            scopedModels.has(normalizeModelName(displayName))
        ) {
            continue
        }

        windows.push({
            label: '7d',
            usedPercent,
            resetsAt: parseTimestamp(limit.resets_at),
            model: displayName.trim(),
        })
    }

    return windows
}

/** Format a quota duration as the largest exact common unit. */
function formatWindowLabel(seconds: number): string {
    if (seconds % 86_400 === 0) {
        return `${seconds / 86_400}d`
    }

    if (seconds % 3_600 === 0) {
        return `${seconds / 3_600}h`
    }

    if (seconds % 60 === 0) {
        return `${seconds / 60}m`
    }

    return `${seconds}s`
}

/** Normalize one OpenAI Codex rate-limit window. */
function parseOpenAiWindow(value: unknown): QuotaWindow | undefined {
    const window = asRecord(value)

    if (!window) {
        return undefined
    }

    const usedPercent = asFiniteNumber(window.used_percent)
    const windowSeconds = asFiniteNumber(window.limit_window_seconds)

    if (usedPercent === undefined || windowSeconds === undefined || windowSeconds <= 0) {
        return undefined
    }

    const resetAfterSeconds = asFiniteNumber(window.reset_after_seconds)
    const resetsAt =
        parseTimestamp(window.reset_at) ??
        (resetAfterSeconds !== undefined && resetAfterSeconds >= 0
            ? Date.now() + resetAfterSeconds * 1000
            : undefined)

    return {
        label: formatWindowLabel(windowSeconds),
        usedPercent,
        resetsAt,
    }
}

/** Normalize OpenAI Codex's primary and secondary rate-limit windows. */
function parseOpenAiUsage(value: unknown): QuotaWindow[] {
    const data = asRecord(value)
    const rateLimit = asRecord(data?.rate_limit)

    if (!rateLimit) {
        throw new Error('Malformed OpenAI quota response')
    }

    return [
        parseOpenAiWindow(rateLimit.primary_window),
        parseOpenAiWindow(rateLimit.secondary_window),
    ].filter((window): window is QuotaWindow => window !== undefined)
}

/** Decode the ChatGPT account ID from an OpenAI OAuth access token. */
function openAiAccountId(accessToken: string): string {
    const payloadPart = accessToken.split('.')[1]

    if (!payloadPart) {
        throw new Error('Invalid OpenAI OAuth token')
    }

    const payload = asRecord(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')))
    const authClaim = asRecord(payload?.[OPENAI_AUTH_CLAIM])
    const accountId = authClaim?.chatgpt_account_id

    if (typeof accountId !== 'string' || !accountId) {
        throw new Error('OpenAI OAuth token has no account ID')
    }

    return accountId
}

/** Fetch JSON and reject non-successful responses. */
async function fetchJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { ...init, signal })

    if (!response.ok) {
        throw new Error(`Quota request failed with HTTP ${response.status}`)
    }

    return response.json()
}

/** Fetch Anthropic subscription quota windows. */
async function fetchAnthropicQuota(
    accessToken: string,
    signal?: AbortSignal,
): Promise<QuotaWindow[]> {
    const data = await fetchJson(
        ANTHROPIC_USAGE_URL,
        {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
            },
        },
        signal,
    )

    return parseAnthropicUsage(data)
}

/** Fetch OpenAI Codex subscription quota windows. */
async function fetchOpenAiQuota(accessToken: string, signal?: AbortSignal): Promise<QuotaWindow[]> {
    const data = await fetchJson(
        OPENAI_USAGE_URL,
        {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'ChatGPT-Account-Id': openAiAccountId(accessToken),
            },
        },
        signal,
    )

    return parseOpenAiUsage(data)
}

const QUOTA_FETCHERS: Record<
    SupportedQuotaProvider,
    (accessToken: string, signal?: AbortSignal) => Promise<QuotaWindow[]>
> = {
    anthropic: fetchAnthropicQuota,
    'openai-codex': fetchOpenAiQuota,
}

/** Fetch and normalize quota windows for a supported provider. */
export function fetchQuotaWindows(
    provider: SupportedQuotaProvider,
    accessToken: string,
    signal?: AbortSignal,
): Promise<QuotaWindow[]> {
    return QUOTA_FETCHERS[provider](accessToken, signal)
}
