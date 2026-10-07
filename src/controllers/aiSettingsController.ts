import { Request, Response } from 'express';
import { AIProviderConfig, AI_PROVIDERS, AIProviderId } from '../models/AIProviderConfig.js';
import { AIUsageLog } from '../models/AIUsage.js';
import { Tenant } from '../models/index.js';
import { asyncHandler, AppError } from '../middleware/index.js';
import {
    aiGateway,
    resolveFromConfig,
    getMonthlyUsage,
    planTokenAllowance,
    BYOK_MONTHLY_FEE_USD,
} from '../services/aiGateway.js';

/**
 * Tenant AI settings: bring your own key (BYOK) + usage.
 * Mounted at /api/v1/ai/settings and /api/v1/ai/usage.
 */

const isProvider = (p: unknown): p is AIProviderId => typeof p === 'string' && p in AI_PROVIDERS;

function validateBaseURL(provider: AIProviderId, baseURL?: string) {
    if (!baseURL) {
        if (provider === 'custom') throw new AppError('Base URL is required for a custom provider', 400);
        return undefined;
    }
    let u: URL;
    try {
        u = new URL(baseURL);
    } catch {
        throw new AppError('Base URL is not a valid URL', 400);
    }
    if (!['http:', 'https:'].includes(u.protocol)) throw new AppError('Base URL must be http(s)', 400);
    // Plain http only for local/self-hosted model servers
    if (u.protocol === 'http:' && process.env.NODE_ENV === 'production' && provider !== 'ollama' && provider !== 'custom') {
        throw new AppError('Base URL must use https', 400);
    }
    return baseURL.replace(/\/+$/, '');
}

export const getAISettings = asyncHandler(async (req: Request, res: Response) => {
    const config = await AIProviderConfig.findOne({ tenantId: req.tenantId });
    res.json({
        success: true,
        data: {
            config,
            providers: AI_PROVIDERS,
            platformAvailable: Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY),
            byokMonthlyFeeUsd: BYOK_MONTHLY_FEE_USD(),
        },
    });
});

export const saveAISettings = asyncHandler(async (req: Request, res: Response) => {
    const { provider, apiKey, baseURL, defaultModel, embeddingModel, isActive, skipTest } = req.body || {};
    if (!isProvider(provider)) throw new AppError('Choose a supported AI provider', 400);

    let config = await AIProviderConfig.findOne({ tenantId: req.tenantId });
    const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
    if (!config && !key && provider !== 'ollama') throw new AppError('API key is required', 400);
    if (config && config.provider !== provider && !key && provider !== 'ollama') {
        throw new AppError('Enter the API key for the new provider', 400);
    }

    const draft = {
        provider,
        apiKey: key ?? config?.apiKey ?? 'ollama',
        baseURL: validateBaseURL(provider, baseURL),
        defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : undefined,
        embeddingModel: typeof embeddingModel === 'string' && embeddingModel.trim() ? embeddingModel.trim() : undefined,
    };

    // Verify the key with a real (tiny) request before saving, unless asked not to
    let verified = false;
    let lastError: string | undefined;
    if (!skipTest) {
        const resolved = key
            ? { ...resolveFromConfig({ ...draft, apiKey: '' }), apiKey: key }
            : resolveFromConfig(draft);
        try {
            await aiGateway.testProvider(resolved);
            verified = true;
        } catch (err: any) {
            throw new AppError(`Key check failed: ${err.message}`, 400);
        }
    }

    if (!config) config = new AIProviderConfig({ tenantId: req.tenantId, ...draft });
    else config.set(draft);
    config.isActive = isActive !== undefined ? Boolean(isActive) : true;
    config.isVerified = verified;
    config.lastTestedAt = verified ? new Date() : config.lastTestedAt;
    config.lastError = lastError;
    await config.save();

    res.json({ success: true, data: config, message: 'AI provider saved — AI features now use your own key' });
});

export const testAISettings = asyncHandler(async (req: Request, res: Response) => {
    const config = await AIProviderConfig.findOne({ tenantId: req.tenantId });
    if (!config) throw new AppError('No AI provider configured', 404);
    try {
        const result = await aiGateway.testProvider(resolveFromConfig(config));
        config.isVerified = true;
        config.lastError = undefined;
        config.lastTestedAt = new Date();
        await config.save();
        res.json({ success: true, data: result, message: 'Connection works' });
    } catch (err: any) {
        config.isVerified = false;
        config.lastError = String(err.message).slice(0, 500);
        config.lastTestedAt = new Date();
        await config.save();
        throw err;
    }
});

export const deleteAISettings = asyncHandler(async (req: Request, res: Response) => {
    await AIProviderConfig.deleteOne({ tenantId: req.tenantId });
    res.json({ success: true, message: 'Your key was removed — AI features now use platform credits' });
});

export const getAIUsage = asyncHandler(async (req: Request, res: Response) => {
    const tenantId = String(req.tenantId);
    const [tenant, monthly, config] = await Promise.all([
        Tenant.findById(tenantId).select('subscription.plan').lean(),
        getMonthlyUsage(tenantId),
        AIProviderConfig.findOne({ tenantId, isActive: true }).select('provider keyLast4 isVerified').lean(),
    ]);
    const allowance = planTokenAllowance((tenant as any)?.subscription?.plan);
    const monthStart = new Date(`${monthly.month}-01T00:00:00.000Z`);

    const [byFeature, daily] = await Promise.all([
        AIUsageLog.aggregate([
            { $match: { tenantId: req.tenant!._id, createdAt: { $gte: monthStart } } },
            { $group: { _id: { feature: '$feature', keySource: '$keySource' }, tokens: { $sum: '$totalTokens' }, requests: { $sum: 1 }, errors: { $sum: { $cond: ['$success', 0, 1] } } } },
            { $sort: { tokens: -1 } },
            { $limit: 30 },
        ]),
        AIUsageLog.aggregate([
            { $match: { tenantId: req.tenant!._id, createdAt: { $gte: new Date(Date.now() - 30 * 86_400_000) } } },
            { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, keySource: '$keySource' }, tokens: { $sum: '$totalTokens' } } },
            { $sort: { '_id.day': 1 } },
        ]),
    ]);

    res.json({
        success: true,
        data: {
            ...monthly,
            plan: (tenant as any)?.subscription?.plan || 'free',
            platformAllowance: allowance,
            platformRemaining: Math.max(0, allowance - monthly.platformTokens),
            byok: config ? { active: true, provider: config.provider, keyLast4: config.keyLast4, verified: config.isVerified, monthlyFeeUsd: BYOK_MONTHLY_FEE_USD() } : { active: false },
            byFeature: byFeature.map((f) => ({ feature: f._id.feature, keySource: f._id.keySource, tokens: f.tokens, requests: f.requests, errors: f.errors })),
            daily: daily.map((d) => ({ day: d._id.day, keySource: d._id.keySource, tokens: d.tokens })),
        },
    });
});
