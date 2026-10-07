import { AsyncLocalStorage } from 'async_hooks';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AIProviderConfig, AI_PROVIDERS, AIProviderId, IAIProviderConfig } from '../models/AIProviderConfig.js';
import { AIUsageMonthly, AIUsageLog, AIKeySource } from '../models/AIUsage.js';
import { Tenant } from '../models/index.js';
import { decrypt } from './cryptoService.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * AI Gateway — every LLM / embedding call goes through here.
 *
 *  1. Works out WHO is calling (tenant/project/feature) from request context.
 *  2. Uses the tenant's own key (BYOK) when configured, otherwise platform
 *     credits — and refuses when the plan's monthly AI allowance is used up.
 *  3. Meters tokens per tenant, per feature.
 */

// ---------------------------------------------------------------------------
// Request-scoped context
// ---------------------------------------------------------------------------

interface AIContextStore {
    req?: Request;
    tenantId?: string;
    projectId?: string;
    feature?: string;
}

const als = new AsyncLocalStorage<AIContextStore>();

/** Express middleware: makes the request available to AI calls further down. */
export function aiContextMiddleware(req: Request, _res: Response, next: NextFunction) {
    als.run({ req }, next);
}

/** Run fn with an explicit AI context (public widgets, workers). */
export function runWithAIContext<T>(ctx: Omit<AIContextStore, 'req'>, fn: () => Promise<T>): Promise<T> {
    return als.run({ ...als.getStore(), ...ctx }, fn);
}

function currentContext(): { tenantId?: string; projectId?: string; feature: string } {
    const store = als.getStore() || {};
    const req = store.req;
    // tenantId is read lazily: auth middleware sets it after this context is created
    const tenantId = store.tenantId || req?.tenantId;
    const projectId = store.projectId || (req?.params?.projectId as string | undefined) || (req?.body?.projectId as string | undefined);
    const feature = store.feature || (req ? `${req.baseUrl}${req.path}`.replace(/^\/api\/v1/, '').replace(/[0-9a-f]{24}/g, ':id').slice(0, 80) : 'background');
    return {
        tenantId: tenantId ? String(tenantId) : undefined,
        projectId: projectId && Types.ObjectId.isValid(String(projectId)) ? String(projectId) : undefined,
        feature,
    };
}

// ---------------------------------------------------------------------------
// Plans & credits
// ---------------------------------------------------------------------------

/** Monthly platform AI tokens included per plan (override via env AI_TOKENS_<PLAN>). */
const DEFAULT_PLAN_TOKENS: Record<string, number> = {
    free: 50_000,
    basic: 500_000,
    starter: 500_000,
    pro: 2_000_000,
    professional: 2_000_000,
    business: 5_000_000,
    enterprise: 10_000_000,
};

export function planTokenAllowance(plan: string | undefined): number {
    const key = (plan || 'free').toLowerCase();
    const env = process.env[`AI_TOKENS_${key.toUpperCase()}`];
    if (env && !isNaN(Number(env))) return Number(env);
    return DEFAULT_PLAN_TOKENS[key] ?? DEFAULT_PLAN_TOKENS.free;
}

export const BYOK_MONTHLY_FEE_USD = () => Number(process.env.BYOK_PLATFORM_FEE_USD ?? 5);

const monthKey = () => new Date().toISOString().slice(0, 7);

export async function getMonthlyUsage(tenantId: string) {
    const doc = await AIUsageMonthly.findOne({ tenantId, month: monthKey() }).lean();
    return {
        month: monthKey(),
        platformTokens: doc?.platformTokens || 0,
        byokTokens: doc?.byokTokens || 0,
        platformRequests: doc?.platformRequests || 0,
        byokRequests: doc?.byokRequests || 0,
    };
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
    provider: AIProviderId;
    apiKey: string;
    baseURL: string;
    model: string;
    embeddingModel: string;
    keySource: AIKeySource;
}

function platformProvider(): ResolvedProvider | null {
    if (process.env.ANTHROPIC_API_KEY && process.env.AI_PLATFORM_PROVIDER === 'anthropic') {
        return {
            provider: 'anthropic',
            apiKey: process.env.ANTHROPIC_API_KEY,
            baseURL: AI_PROVIDERS.anthropic.baseURL,
            model: process.env.AI_PLATFORM_MODEL || AI_PROVIDERS.anthropic.defaultModel,
            embeddingModel: process.env.OPENROUTER_API_KEY ? AI_PROVIDERS.openrouter.embeddingModel : '',
            keySource: 'platform',
        };
    }
    if (!process.env.OPENROUTER_API_KEY) return null;
    return {
        provider: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: AI_PROVIDERS.openrouter.baseURL,
        model: process.env.AI_PLATFORM_MODEL || AI_PROVIDERS.openrouter.defaultModel,
        embeddingModel: AI_PROVIDERS.openrouter.embeddingModel,
        keySource: 'platform',
    };
}

export function resolveFromConfig(cfg: Pick<IAIProviderConfig, 'provider' | 'apiKey' | 'baseURL' | 'defaultModel' | 'embeddingModel'>): ResolvedProvider {
    const preset = AI_PROVIDERS[cfg.provider];
    return {
        provider: cfg.provider,
        apiKey: decrypt(cfg.apiKey),
        baseURL: (cfg.baseURL || preset.baseURL).replace(/\/+$/, ''),
        model: cfg.defaultModel || preset.defaultModel,
        embeddingModel: cfg.embeddingModel || preset.embeddingModel,
        keySource: 'byok',
    };
}

export async function getTenantConfig(tenantId?: string) {
    if (!tenantId || !Types.ObjectId.isValid(tenantId)) return null;
    return AIProviderConfig.findOne({ tenantId, isActive: true });
}

/** Pick the provider for this call and enforce platform credits. */
async function resolve(tenantId: string | undefined, estimatedTokens: number): Promise<ResolvedProvider> {
    const cfg = await getTenantConfig(tenantId);
    if (cfg) return resolveFromConfig(cfg);

    const platform = platformProvider();
    if (!platform) {
        throw new AppError('AI is not configured. Add your own AI provider key in Settings → AI, or ask the platform admin to set one up.', 503);
    }

    if (tenantId) {
        const tenant = await Tenant.findById(tenantId).select('subscription.plan').lean();
        const allowance = planTokenAllowance((tenant as any)?.subscription?.plan);
        const used = (await getMonthlyUsage(tenantId)).platformTokens;
        if (used + estimatedTokens > allowance) {
            throw new AppError(
                `You've used this month's AI credits (${used.toLocaleString()} / ${allowance.toLocaleString()} tokens). Connect your own AI key in Settings → AI or upgrade your plan.`,
                402
            );
        }
    }
    return platform;
}

async function meter(
    ctx: ReturnType<typeof currentContext>,
    p: ResolvedProvider,
    model: string,
    usage: { input: number; output: number },
    durationMs: number,
    error?: string
) {
    const total = usage.input + usage.output;
    try {
        if (ctx.tenantId) {
            const inc = p.keySource === 'byok'
                ? { byokTokens: total, byokRequests: 1 }
                : { platformTokens: total, platformRequests: 1 };
            await AIUsageMonthly.updateOne({ tenantId: ctx.tenantId, month: monthKey() }, { $inc: inc }, { upsert: true });
        }
        await AIUsageLog.create({
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            feature: ctx.feature,
            provider: p.provider,
            aiModel: model,
            keySource: p.keySource,
            inputTokens: usage.input,
            outputTokens: usage.output,
            totalTokens: total,
            durationMs,
            success: !error,
            error: error?.slice(0, 500),
        });
    } catch (err) {
        console.warn('[ai] usage metering failed:', (err as Error).message);
    }
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

export interface ChatOptions {
    maxTokens?: number;
    temperature?: number;
    model?: string;
    system?: string;
}

interface ChatResult {
    text: string;
    usage: { input: number; output: number };
    model: string;
}

async function callOpenAICompatible(p: ResolvedProvider, prompt: string, opts: ChatOptions): Promise<ChatResult> {
    const model = opts.model || p.model;
    const messages = [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt },
    ];
    const body: Record<string, unknown> = { model, messages };
    if (p.provider === 'openai') {
        // Newer OpenAI models take max_completion_tokens and only the default temperature
        body.max_completion_tokens = opts.maxTokens || 1000;
    } else {
        body.max_tokens = opts.maxTokens || 1000;
        if (opts.temperature !== undefined) body.temperature = opts.temperature;
    }
    const headers: Record<string, string> = {
        Authorization: `Bearer ${p.apiKey}`,
        'Content-Type': 'application/json',
    };
    if (p.provider === 'openrouter') {
        headers['HTTP-Referer'] = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5174';
        headers['X-Title'] = 'Headless CMS';
    }
    const res = await axios.post(`${p.baseURL}/chat/completions`, body, { headers, timeout: 120_000 });
    const choice = res.data?.choices?.[0];
    return {
        text: choice?.message?.content ?? '',
        usage: { input: res.data?.usage?.prompt_tokens || 0, output: res.data?.usage?.completion_tokens || 0 },
        model: res.data?.model || model,
    };
}

async function callAnthropic(p: ResolvedProvider, prompt: string, opts: ChatOptions): Promise<ChatResult> {
    const client = new Anthropic({ apiKey: p.apiKey, timeout: 120_000 });
    const model = opts.model || p.model;
    // Thinking is adaptive and counts toward max_tokens, so leave headroom.
    // Sampling params (temperature) are not accepted on current Claude models.
    const params: Record<string, unknown> = {
        model,
        max_tokens: 16000,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: (opts.maxTokens ?? 1000) <= 200 ? 'low' : 'medium' },
        // Server-side refusal fallback routes declined requests to another model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
    };
    const response = await client.beta.messages.create(params as any) as any;
    if (response.stop_reason === 'refusal') {
        throw new AppError('The AI model declined this request. Try rephrasing it.', 422);
    }
    const text = (response.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
    return {
        text,
        usage: { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 },
        model: response.model || model,
    };
}

async function callProvider(p: ResolvedProvider, prompt: string, opts: ChatOptions): Promise<ChatResult> {
    return p.provider === 'anthropic' ? callAnthropic(p, prompt, opts) : callOpenAICompatible(p, prompt, opts);
}

function describeProviderError(err: any): string {
    if (err instanceof Anthropic.AuthenticationError) return 'Invalid API key for the AI provider';
    if (err instanceof Anthropic.RateLimitError) return 'AI provider rate limit reached — try again shortly';
    if (err instanceof Anthropic.APIError) return `AI provider error (${err.status}): ${err.message}`;
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err?.response?.data?.message || err?.message;
    if (status === 401 || status === 403) return 'Invalid API key for the AI provider';
    if (status === 429) return 'AI provider rate limit or quota reached';
    return status ? `AI provider error (${status}): ${msg}` : String(msg || 'AI request failed');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const aiGateway = {
    /** Text generation with BYOK / platform resolution and metering. */
    async chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
        const ctx = currentContext();
        const p = await resolve(ctx.tenantId, Math.ceil(prompt.length / 4) + (opts.maxTokens || 1000));
        // Always use the resolved provider's model: a feature's stored model name
        // (e.g. a bot persona) may not exist on the tenant's provider.
        const callOpts = { ...opts, model: undefined };
        const started = Date.now();
        try {
            const result = await callProvider(p, prompt, callOpts);
            await meter(ctx, p, result.model, result.usage, Date.now() - started);
            return result.text;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            const message = describeProviderError(err);
            await meter(ctx, p, callOpts.model || p.model, { input: 0, output: 0 }, Date.now() - started, message);
            throw new AppError(message, 502);
        }
    },

    /** Embedding vector, or [] when no embedding-capable provider is available. */
    async embed(text: string): Promise<number[]> {
        const ctx = currentContext();
        let p: ResolvedProvider | null = null;
        const cfg = await getTenantConfig(ctx.tenantId);
        if (cfg) {
            const r = resolveFromConfig(cfg);
            if (r.embeddingModel && r.provider !== 'anthropic') p = r;
        }
        // Embeddings are tiny; fall back to the platform key when the tenant's provider has none
        if (!p) {
            const platform = platformProvider();
            if (platform?.embeddingModel && platform.provider !== 'anthropic') p = platform;
            else if (process.env.OPENROUTER_API_KEY) {
                p = {
                    provider: 'openrouter',
                    apiKey: process.env.OPENROUTER_API_KEY,
                    baseURL: AI_PROVIDERS.openrouter.baseURL,
                    model: AI_PROVIDERS.openrouter.defaultModel,
                    embeddingModel: AI_PROVIDERS.openrouter.embeddingModel,
                    keySource: 'platform',
                };
            }
        }
        if (!p) return [];

        const started = Date.now();
        try {
            const res = await axios.post(
                `${p.baseURL}/embeddings`,
                { model: p.embeddingModel, input: text.slice(0, 8000) },
                { headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60_000 }
            );
            const vector = res.data?.data?.[0]?.embedding;
            await meter({ ...ctx, feature: `${ctx.feature}:embedding` }, p, p.embeddingModel, { input: res.data?.usage?.prompt_tokens || Math.ceil(text.length / 4), output: 0 }, Date.now() - started);
            return Array.isArray(vector) ? vector : [];
        } catch (err: any) {
            console.warn('[ai] embedding failed:', describeProviderError(err));
            return [];
        }
    },

    /** Validate a key by making a tiny real request. */
    async testProvider(p: ResolvedProvider): Promise<{ model: string; sample: string }> {
        try {
            const result = await callProvider(p, 'Reply with the single word: OK', { maxTokens: 20 });
            return { model: result.model, sample: result.text.slice(0, 50) };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new AppError(describeProviderError(err), 400);
        }
    },

    /** True when any AI path is usable for the current tenant. */
    async isAvailable(): Promise<{ available: boolean; keySource: AIKeySource | null; provider?: string }> {
        const ctx = currentContext();
        const cfg = await getTenantConfig(ctx.tenantId);
        if (cfg) return { available: true, keySource: 'byok', provider: cfg.provider };
        const platform = platformProvider();
        return platform ? { available: true, keySource: 'platform', provider: platform.provider } : { available: false, keySource: null };
    },
};
