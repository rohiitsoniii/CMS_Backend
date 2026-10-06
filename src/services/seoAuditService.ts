import axios from 'axios';
import * as cheerio from 'cheerio';
import { SeoAuditReport, IAuditIssue } from '../models/SeoAuditReport';
import { Project } from '../models/Project';

export class SeoAuditService {
  private visited = new Set<string>();
  private queue: string[] = [];
  private issues: IAuditIssue[] = [];
  private maxPages = 50;

  /**
   * Starts a background audit process
   */
  public async runAudit(projectId: string, tenantId: string) {
    const report = await SeoAuditReport.create({
      projectId,
      tenantId,
      status: 'crawling',
      startedAt: new Date(),
    });

    // Run in background (don't await)
    this.processAudit(report);

    return report;
  }

  private async processAudit(report: any) {
    try {
      const project = await Project.findById(report.projectId);
      if (!project || !project.domain) {
        throw new Error('Project domain not configured for audit');
      }

      const baseUrl = project.domain.startsWith('http') ? project.domain : `https://${project.domain}`;
      this.queue.push(baseUrl);
      this.visited.clear();
      this.issues = [];

      while (this.queue.length > 0 && this.visited.size < this.maxPages) {
        const url = this.queue.shift()!;
        if (this.visited.has(url)) continue;
        
        this.visited.add(url);
        await this.analyzePage(url, baseUrl);
      }

      // Calculate health score
      const errorCount = this.issues.filter(i => i.type === 'error').length;
      const warningCount = this.issues.filter(i => i.type === 'warning').length;
      const infoCount = this.issues.filter(i => i.type === 'info').length;

      // Base score 100, -5 per error, -2 per warning
      const healthScore = Math.max(0, 100 - (errorCount * 5) - (warningCount * 2));

      report.status = 'completed';
      report.totalUrlsScanned = this.visited.size;
      report.healthScore = healthScore;
      report.issues = this.issues;
      report.summary = { errors: errorCount, warnings: warningCount, info: infoCount };
      report.completedAt = new Date();
      await report.save();

    } catch (error: any) {
      console.error('Audit Processing Failed:', error);
      report.status = 'failed';
      report.error = error.message;
      await report.save();
    }
  }

  private async analyzePage(url: string, baseUrl: string) {
    try {
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: { 'User-Agent': 'HeadlessCMS-AuditBot/1.0' }
      });

      const $ = cheerio.load(response.data);
      const host = new URL(baseUrl).host;

      // 1. Meta Title
      const title = $('title').text();
      if (!title) {
        this.addIssue(url, 'error', 'meta', 'Missing Title Tag', 'Add a <title> tag between 50-60 characters.', 'high');
      } else if (title.length > 60) {
        this.addIssue(url, 'warning', 'meta', 'Title too long', 'Keep titles under 60 characters to avoid truncation in SERPs.', 'medium');
      } else if (title.length < 30) {
        this.addIssue(url, 'info', 'meta', 'Title too short', 'Expand the title to 50-60 characters to improve keyword density.', 'low');
      }

      // 2. Meta Description
      const desc = $('meta[name="description"]').attr('content');
      if (!desc) {
        this.addIssue(url, 'error', 'meta', 'Missing Meta Description', 'Add a meta description (150-160 chars) to improve click-through rate.', 'high');
      } else if (desc.length > 165) {
        this.addIssue(url, 'warning', 'meta', 'Description too long', 'Google will truncate descriptions over 160 characters.', 'medium');
      }

      // 3. H1 Tags
      const h1Count = $('h1').length;
      if (h1Count === 0) {
        this.addIssue(url, 'warning', 'content', 'Missing H1 Tag', 'Every page should have exactly one H1 tag defining its main topic.', 'high');
      } else if (h1Count > 1) {
        this.addIssue(url, 'error', 'content', 'Multiple H1 Tags', 'Detected multiple H1 tags. Use only one <h1> per page for optimal hierarchy.', 'medium');
      }

      // 4. Images & Alt Text
      $('img').each((_, el) => {
        const alt = $(el).attr('alt');
        const src = $(el).attr('src');
        if (!alt || alt.trim() === '') {
          this.addIssue(url, 'warning', 'images', 'Missing Image Alt Text', `Image (${src}) is missing an alt attribute. This hurts accessibility and image SEO.`, 'medium');
        }
      });

      // 5. Links & Crawling
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        try {
          const absoluteUrl = new URL(href, url).href;
          const urlObj = new URL(absoluteUrl);

          // If internal link, add to queue
          if (urlObj.host === host && !this.visited.has(absoluteUrl) && !this.queue.includes(absoluteUrl)) {
            // Very basic filter to avoid assets/emails
            if (!absoluteUrl.includes('#') && !absoluteUrl.startsWith('mailto:') && !absoluteUrl.match(/\.(jpg|jpeg|png|gif|pdf|zip)$/i)) {
              this.queue.push(absoluteUrl);
            }
          }
        } catch (e) {
          // Invalid URL
        }
      });

    } catch (error: any) {
      this.addIssue(url, 'error', 'links', `Broken Link (${error.response?.status || 'Timeout'})`, `Failed to fetch URL: ${url}`);
    }
  }

  private addIssue(
    url: string, 
    type: 'error'|'warning'|'info', 
    category: any, 
    message: string, 
    recommendation: string,
    impact: 'high' | 'medium' | 'low' = 'medium'
  ) {
    this.issues.push({ url, type, category, message, recommendation, impact });
  }
}

export const seoAuditService = new SeoAuditService();
