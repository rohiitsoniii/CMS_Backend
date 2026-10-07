import { webhookService } from './webhookService.js';
import { ragIngestionService } from './ragIngestionService.js';
import { runWithAIContext } from './aiGateway.js';
import { seoPingService } from './seoPingService.js';

/**
 * Side effects of content lifecycle changes. All work is fire-and-forget so a
 * slow webhook or embedding call never blocks the editor's request.
 */

type ContentLike = {
  _id: any;
  projectId?: any;
  tenantId?: any;
  name?: string;
  slug?: string;
  type?: string;
  contentTypeApiId?: string;
};

const payload = (c: ContentLike) => ({
  contentId: c._id,
  type: c.contentTypeApiId || c.type,
  slug: c.slug,
  name: c.name,
});

function background(label: string, fn: () => Promise<unknown>) {
  fn().catch((err) => console.error(`[contentEvents] ${label} failed:`, err?.message || err));
}

function withTenant(c: ContentLike, fn: () => Promise<unknown>) {
  return () =>
    runWithAIContext(
      { tenantId: c.tenantId ? String(c.tenantId) : undefined, projectId: c.projectId ? String(c.projectId) : undefined, feature: 'chatbot:content-sync' },
      fn as () => Promise<unknown>
    );
}

export const contentEvents = {
  published(content: ContentLike, opts: { webhook?: boolean } = { webhook: true }) {
    if (!content.projectId) return;
    if (opts.webhook !== false) {
      background('webhook', () => webhookService.triggerWebhook(String(content.projectId), 'content.published', payload(content)));
    }
    background('knowledge sync', withTenant(content, () => ragIngestionService.syncContentItem(content)));
    background('search engine ping', () => seoPingService.contentPublished(content));
  },

  unpublished(content: ContentLike, opts: { webhook?: boolean } = { webhook: true }) {
    if (!content.projectId) return;
    if (opts.webhook !== false) {
      background('webhook', () => webhookService.triggerWebhook(String(content.projectId), 'content.unpublished', payload(content)));
    }
    background('knowledge removal', () => ragIngestionService.removeContentKnowledge(content._id));
  },

  deleted(content: ContentLike) {
    if (!content.projectId) return;
    background('webhook', () => webhookService.triggerWebhook(String(content.projectId), 'content.deleted', payload(content)));
    background('knowledge removal', () => ragIngestionService.removeContentKnowledge(content._id));
  },
};
