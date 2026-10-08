import mongoose, { Schema, Document } from 'mongoose';
import { encrypt, isEncrypted } from '../services/cryptoService.js';

/**
 * Bring-Your-Own-Key AI configuration (one per tenant). When active, every AI
 * feature for this tenant runs on the tenant's own provider account instead
 * of platform credits.
 */

export const AI_PROVIDERS = {
    openai: {
        label: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
        keyHint: 'Create a key at platform.openai.com → API keys',
    },
    anthropic: {
        label: 'Anthropic (Claude)',
        baseURL: 'https://api.anthropic.com',
        defaultModel: 'claude-opus-5-5',
        embeddingModel: '',
        keyHint: 'Create a key at console.anthropic.com → API Keys',
    },
    gemini: {
        label: 'Google Gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-2.0-flash',
        embeddingModel: 'text-embedding-004',
        keyHint: 'Create a key at aistudio.google.com → Get API key',
    },
    openrouter: {
        label: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api/v1',
        defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
        embeddingModel: 'nomic-ai/nomic-embed-text-v1.5',
        keyHint: 'Create a key at openrouter.ai/keys — gives access to hundreds of models',
    },
    ollama: {
        label: 'Ollama (self-hosted)',
        baseURL: 'http://localhost:11434/v1',
        defaultModel: 'llama3.1',
        embeddingModel: 'nomic-embed-text',
        keyHint: 'Point the base URL at your Ollama server; the key can be any value',
    },
    custom: {
        label: 'Custom (OpenAI-compatible)',
        baseURL: '',
        defaultModel: '',
        embeddingModel: '',
        keyHint: 'Any OpenAI-compatible endpoint (Azure OpenAI proxy, Groq, Together, vLLM, LM Studio...)',
    },
} as const;

export type AIProviderId = keyof typeof AI_PROVIDERS;

export interface IAIProviderConfig extends Document {
    tenantId: mongoose.Types.ObjectId;
    provider: AIProviderId;
    /** Encrypted at rest; never returned to clients */
    apiKey: string;
    keyLast4?: string;
    baseURL?: string;
    defaultModel?: string;
    embeddingModel?: string;
    isActive: boolean;
    isVerified: boolean;
    lastTestedAt?: Date;
    lastError?: string;
    /** YYYY-MM of the last BYOK platform fee billed */
    feeBilledMonth?: string;
    createdAt: Date;
    updatedAt: Date;
}

const AIProviderConfigSchema = new Schema<IAIProviderConfig>(
    {
        tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
        provider: { type: String, enum: Object.keys(AI_PROVIDERS), required: true },
        apiKey: { type: String, required: true },
        keyLast4: { type: String },
        baseURL: { type: String, trim: true, maxlength: 500 },
        defaultModel: { type: String, trim: true, maxlength: 200 },
        embeddingModel: { type: String, trim: true, maxlength: 200 },
        isActive: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
        lastTestedAt: { type: Date },
        lastError: { type: String },
        feeBilledMonth: { type: String },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_doc, ret: any) => {
                delete ret.apiKey;
                ret.hasKey = true;
                return ret;
            },
        },
    }
);

AIProviderConfigSchema.pre('save', function (next) {
    if (this.apiKey && !isEncrypted(this.apiKey)) {
        this.keyLast4 = this.apiKey.slice(-4);
        this.apiKey = encrypt(this.apiKey);
    }
    next();
});

export const AIProviderConfig = mongoose.model<IAIProviderConfig>('AIProviderConfig', AIProviderConfigSchema);
