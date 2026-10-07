import { Content } from '../models/index.js';
import mongoose from 'mongoose';
import { aiGateway } from './aiGateway.js';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export class EmbeddingService {
  /**
   * Generate an embedding vector for a given text string.
   * Returns [] when no embedding provider is available — callers fall back
   * to keyword search. (Never returns fake vectors.)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text?.trim()) return [];
    return aiGateway.embed(text);
  }

  /**
   * Create and store embedding for a Content document
   */
  async embedContent(contentId: string): Promise<void> {
    const content = await Content.findById(contentId);
    if (!content) return;

    const textToEmbed = `${content.name} ${JSON.stringify(content.data)}`;
    const vector = await this.generateEmbedding(textToEmbed);

    if (vector.length > 0) {
      content.meta = content.meta || ({} as any);
      (content.meta as any).embedding = vector;
      await content.save({ validateBeforeSave: false });
    }
  }

  /**
   * Semantic search over a project's content: cosine similarity on stored
   * vectors, falling back to MongoDB text search.
   */
  async semanticSearch(projectId: string, query: string, limit: number = 10): Promise<any[]> {
    const queryVector = await this.generateEmbedding(query);
    const pid = new mongoose.Types.ObjectId(projectId);

    if (queryVector.length > 0) {
      const candidates = await Content.find({ projectId: pid, isDeleted: { $ne: true }, 'meta.embedding.0': { $exists: true } })
        .limit(5000)
        .lean();
      const scored = candidates
        .map((doc: any) => ({ ...doc, semanticScore: cosineSimilarity(queryVector, doc.meta?.embedding || []) }))
        .filter((d) => d.semanticScore > 0)
        .sort((a, b) => b.semanticScore - a.semanticScore)
        .slice(0, limit)
        .map(({ meta, ...rest }: any) => ({ ...rest, meta: { ...meta, embedding: undefined } }));
      if (scored.length) return scored;
    }

    const results = await Content.find(
      { projectId: pid, $text: { $search: query } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit);

    return results.map((doc) => ({ ...doc.toObject(), semanticScore: null }));
  }
}

export const embeddingService = new EmbeddingService();
