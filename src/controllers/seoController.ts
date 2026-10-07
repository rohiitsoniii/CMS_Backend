import { Request, Response } from 'express';
import { buildSitemapXml } from '../services/geoService.js';
import { SeoReport } from '../models/SeoReport';
import { RobotsConfig } from '../models/RobotsConfig';
import { SeoAuditReport } from '../models/SeoAuditReport';
import { Content } from '../models/Content';
import { Project } from '../models/Project';
import { SeoAnalysisService } from '../services/seoAnalysisService';
import { seoAuditService } from '../services/seoAuditService';
import { KeywordRank } from '../models/KeywordRank';
import aiService from '../services/aiService';

export const seoController = {
  /**
   * Run SEO analysis for a specific content entry
   */
  analyzeContent: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId, contentId } = req.params;
      const { focusKeywords = [] } = req.body;

      const content = await Content.findOne({ _id: contentId, projectId });
      if (!content) {
        return res.status(404).json({ success: false, message: 'Content not found' });
      }

      const results = SeoAnalysisService.analyzeContent(content, focusKeywords);

      // Upsert the report
      const report = await SeoReport.findOneAndUpdate(
        { contentId, projectId },
        {
          ...results,
          focusKeywords,
          tenantId: (req as any).user?.tenantId, // Assuming tenantId on user
          analyzedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        data: report
      });
    } catch (error: any) {
      console.error('SEO Analysis Error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get SEO report for a content entry
   */
  getReport: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId, contentId } = req.params;
      const report = await SeoReport.findOne({ contentId, projectId });
      
      if (!report) {
         // If no report exists, trigger an analysis with default (empty) keywords
         const content = await Content.findOne({ _id: contentId, projectId });
         if (!content) return res.status(404).json({ success: false, message: 'Content not found' });
         
         const results = SeoAnalysisService.analyzeContent(content, []);
         const newReport = await SeoReport.create({
           contentId,
           projectId,
           tenantId: (req as any).user?.tenantId,
           ...results,
           focusKeywords: [],
           analyzedAt: new Date(),
         });
         return res.status(200).json({ success: true, data: newReport });
      }

      return res.status(200).json({ success: true, data: report });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get SEO overview for a project
   */
  getProjectOverview: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const reports = await SeoReport.find({ projectId });
      
      const totalScore = reports.reduce((acc, r) => acc + r.score, 0);
      const avgScore = reports.length > 0 ? (totalScore / reports.length) : 0;
      
      const criticallyLow = reports.filter(r => r.score < 50).length;
      const totalIssues = reports.reduce((acc, r) => acc + r.issues.length, 0);

      return res.status(200).json({
        success: true,
        data: {
          avgScore,
          criticallyLow,
          totalIssues,
          totalCount: reports.length
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Serve XML Sitemap
   */
  getSitemap: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const xml = await buildSitemapXml(projectId);
      res.header('Content-Type', 'application/xml');
      return res.status(200).send(xml);
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get Robots.txt Config
   */
  getRobots: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      let config = await RobotsConfig.findOne({ projectId });
      
      if (!config) {
        const project = await Project.findById(projectId);
        const domain = project?.domain || 'yourdomain.com';
        config = await RobotsConfig.create({
          projectId,
          tenantId: (req as any).user?.tenantId || (req as any).tenantId || project?.tenantId,
          content: `User-agent: *\nAllow: /\n\nSitemap: https://${domain}/sitemap.xml`,
          updatedBy: (req as any).user?._id || (req as any).userId
        });
      }

      return res.status(200).json({ success: true, data: config });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Update Robots.txt Config
   */
  updateRobots: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const { content } = req.body;

      const config = await RobotsConfig.findOneAndUpdate(
        { projectId },
        { 
          content,
          updatedBy: (req as any).user?._id,
          tenantId: (req as any).user?.tenantId
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({ success: true, data: config });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Start a new site audit
   */
  startAudit: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const report = await seoAuditService.runAudit(projectId, (req as any).user?.tenantId);
      return res.status(201).json({ success: true, data: report });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get audit history for a project
   */
  getAuditHistory: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const history = await SeoAuditReport.find({ projectId })
        .sort({ startedAt: -1 })
        .limit(10)
        .select('-issues'); // Summary only
      return res.status(200).json({ success: true, data: history });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get specific audit report details
   */
  getAuditReport: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId, auditId } = req.params;
      const report = await SeoAuditReport.findOne({ _id: auditId, projectId });
      if (!report) return res.status(404).json({ success: false, message: 'Report not found' });
      return res.status(200).json({ success: true, data: report });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Generate SEO metadata using AI
   */
  generateAiSeo: async (req: Request, res: Response): Promise<any> => {
    try {
      const { contentId } = req.params;
      const content = await Content.findById(contentId);
      if (!content) return res.status(404).json({ success: false, message: 'Content not found' });

      // Extract text content for AI
      const textToAnalyze = `${content.name} ${JSON.stringify(content.data)}`;
      
      const [title, description, tags] = await Promise.all([
        aiService.generateSEOTitle(textToAnalyze),
        aiService.generateMetaDescription(content.name, textToAnalyze),
        aiService.generateTags(textToAnalyze, 5)
      ]);

      return res.status(200).json({
        success: true,
        data: {
          title,
          description,
          tags
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Add a keyword to track
   */
  addKeyword: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const { keyword, targetUrl, targetContentId } = req.body;

      const kw = await KeywordRank.create({
        projectId,
        tenantId: (req as any).user?.tenantId,
        keyword,
        targetUrl,
        targetContentId,
        currentRank: 0,
        bestRank: 0,
        rankHistory: [{ rank: 0 }]
      });

      return res.status(201).json({ success: true, data: kw });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get all tracked keywords for a project
   */
  getKeywords: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const keywords = await KeywordRank.find({ projectId }).sort({ currentRank: 1 });
      return res.status(200).json({ success: true, data: keywords });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Delete a tracked keyword
   */
  deleteKeyword: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId, keywordId } = req.params;
      await KeywordRank.deleteOne({ _id: keywordId, projectId });
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get AI keyword suggestions for the project
   */
  suggestKeywords: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      const suggestions = await aiService.suggestKeywords(
        project.name, 
        project.description || '', 
        10
      );

      return res.status(200).json({ success: true, data: suggestions });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get AI backlink strategy suggestions
   */
  suggestBacklinks: async (req: Request, res: Response): Promise<any> => {
    try {
      const { projectId } = req.params;
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      const strategy = await aiService.suggestBacklinkOpportunities(project.name);

      return res.status(200).json({ success: true, data: strategy });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
};
