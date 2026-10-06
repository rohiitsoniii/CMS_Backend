import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
// @ts-ignore
import pdf from 'pdf-parse';
import { Knowledge, RagBot, Content } from '../models/index.js';
import { embeddingService } from './embeddingService.js';
import mongoose from 'mongoose';

export class RagIngestionService {
  /**
   * Chunks text into smaller pieces with overlap
   */
  private chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    let start = 0;

    // Clean whitespace
    const cleanText = text.replace(/\s+/g, ' ').trim();

    while (start < cleanText.length) {
      const end = start + chunkSize;
      let chunk = cleanText.substring(start, end);

      // Try to break at a sentence or space if not at the very end
      if (end < cleanText.length) {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > chunkSize * 0.8) {
          chunk = chunk.substring(0, lastSpace);
        }
      }

      chunks.push(chunk);
      start += (chunk.length - overlap);
      
      // Safety break to prevent infinite loop if overlap is too large
      if (chunk.length <= overlap) {
        start = end;
      }
    }

    return chunks;
  }

  /**
   * Ingest a document file (PDF, TXT, etc.)
   */
  async ingestDocument(
    filePath: string, 
    bot: any, 
    originalName: string
  ): Promise<{ chunksCreated: number }> {
    const fileExt = path.extname(originalName).toLowerCase();
    let text = '';

    if (fileExt === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      text = data.text;
    } else if (fileExt === '.txt' || fileExt === '.md') {
      text = fs.readFileSync(filePath, 'utf8');
    } else {
      throw new Error(`Unsupported file type: ${fileExt}`);
    }

    if (!text || text.trim().length < 10) {
      throw new Error('Document contains no readable text');
    }

    const contentHash = crypto.createHash('md5').update(text).digest('hex');
    
    // Check if this file was already ingested for this project
    const existing = await Knowledge.findOne({ 
      projectId: bot.projectId, 
      contentHash,
      sourceType: 'document' 
    });
    
    if (existing) {
      console.log(`Document ${originalName} already ingested, skipping.`);
      return { chunksCreated: 0 };
    }

    const chunks = this.chunkText(text);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embeddingService.generateEmbedding(chunk);

      await Knowledge.create({
        projectId: bot.projectId,
        tenantId: bot.tenantId,
        question: `Excerpt from ${originalName} (Part ${i + 1})`,
        answer: chunk,
        sourceType: 'document',
        sourceFile: originalName,
        chunkIndex: i,
        contentHash,
        characterCount: chunk.length,
        embedding: embedding,
        category: 'document',
        status: 'active',
        createdBy: bot.createdBy,
        keywords: [originalName, 'document', 'rag'],
      });
    }

    return { chunksCreated: chunks.length };
  }

  /**
   * Ingest a URL (Crawler)
   */
  async ingestUrl(
    url: string, 
    bot: any, 
    maxDepth: number = 1,
    visited: Set<string> = new Set()
  ): Promise<{ chunksCreated: number }> {
    if (visited.has(url) || visited.size > 20) return { chunksCreated: 0 }; // Limit to 20 pages
    visited.add(url);

    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'HeadlessCMS-RagBot/1.0' },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      const baseUrl = new URL(url);
      
      // 1. Extract and Clean Text
      $('script, style, nav, footer, iframe, noscript').remove();
      const title = $('title').text() || url;
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

      let totalChunks = 0;

      if (bodyText.length > 50) {
        const contentHash = crypto.createHash('md5').update(bodyText).digest('hex');
        
        // Only ingest if content is unique for this bot
        const existing = await Knowledge.findOne({ 
          projectId: bot.projectId, 
          contentHash,
          sourceType: 'url' 
        });
        
        if (!existing) {
          const chunks = this.chunkText(bodyText);
          
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = await embeddingService.generateEmbedding(chunk);

            await Knowledge.create({
              projectId: bot.projectId,
              tenantId: bot.tenantId,
              question: `Content from ${title} (${url})`,
              answer: chunk,
              sourceType: 'url',
              sourceUrl: url,
              chunkIndex: i,
              contentHash,
              characterCount: chunk.length,
              embedding: embedding,
              category: 'website',
              status: 'active',
              createdBy: bot.createdBy,
              keywords: [baseUrl.hostname, 'web', 'crawler'],
            });
          }
          totalChunks += chunks.length;
        }
      }

      // 2. Recursive Crawling (if depth permits)
      if (maxDepth > 0) {
        const links: string[] = [];
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) {
            try {
              const absoluteUrl = new URL(href, url).toString().split('#')[0];
              const targetUrl = new URL(absoluteUrl);
              // Only follow links on the same domain
              if (targetUrl.hostname === baseUrl.hostname && !visited.has(absoluteUrl)) {
                 links.push(absoluteUrl);
              }
            } catch (e) {}
          }
        });

        // Limit concurrent pages or process sequentially
        for (const link of links.slice(0, 5)) { // Limit to 5 child links for now
          const res = await this.ingestUrl(link, bot, maxDepth - 1, visited);
          totalChunks += res.chunksCreated;
        }
      }

      return { chunksCreated: totalChunks };
    } catch (error) {
      console.error(`Failed to ingest URL ${url}:`, (error as Error).message);
      return { chunksCreated: 0 };
    }
  }

  /**
   * Ingest CMS Content
   */
  async ingestCmsContent(projectId: string, bot: any): Promise<{ entriesProcessed: number }> {
    const contents = await Content.find({ 
      projectId: new mongoose.Types.ObjectId(projectId),
      status: 'published' 
    });

    let count = 0;
    for (const item of contents) {
      const text = `${item.name}. ${JSON.stringify(item.data)}`;
      const contentHash = crypto.createHash('md5').update(text).digest('hex');

      // Check for duplicates
      const existing = await Knowledge.findOne({ 
        projectId: bot.projectId, 
        contentHash,
        sourceType: 'cms_content' 
      });
      
      if (existing) continue;

      const embedding = await embeddingService.generateEmbedding(text);

      await Knowledge.create({
        projectId: bot.projectId,
        tenantId: bot.tenantId,
        question: `CMS Content: ${item.name}`,
        answer: text,
        sourceType: 'cms_content',
        contentHash,
        characterCount: text.length,
        embedding: embedding,
        category: 'cms',
        status: 'active',
        createdBy: bot.createdBy,
      });
      count++;
    }

    return { entriesProcessed: count };
  }
}

export const ragIngestionService = new RagIngestionService();
