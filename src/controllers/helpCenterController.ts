import { Request, Response } from 'express';
import { HelpCenterService } from '../services/helpCenterService.js';

export class HelpCenterController {
  static async getCategories(req: Request, res: Response) {
    try {
      const categories = await HelpCenterService.getCategories();
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getCategory(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const category = await HelpCenterService.getCategoryBySlug(slug);
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      const articles = await HelpCenterService.getArticlesByCategory(slug);
      res.json({ category, articles });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getArticle(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const article = await HelpCenterService.getArticleBySlug(slug);
      if (!article) {
        return res.status(404).json({ error: 'Article not found' });
      }
      const related = await HelpCenterService.getRelatedArticles(slug);
      res.json({ article, related });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async search(req: Request, res: Response) {
    try {
      const { q, limit } = req.query;
      if (!q) {
        return res.status(400).json({ error: 'Search query required' });
      }
      const articles = await HelpCenterService.searchArticles(q as string, Number(limit) || 10);
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async markHelpful(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const { helpful } = req.body;
      await HelpCenterService.markHelpful(slug, helpful);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getPopular(req: Request, res: Response) {
    try {
      const articles = await HelpCenterService.getPopularArticles(5);
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async createArticle(req: Request, res: Response) {
    try {
      const article = await HelpCenterService.createArticle({
        ...req.body,
        authorId: req.user!.id
      });
      res.status(201).json(article);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async updateArticle(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const article = await HelpCenterService.updateArticle(slug, req.body);
      res.json(article);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async deleteArticle(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      await HelpCenterService.deleteArticle(slug);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async createCategory(req: Request, res: Response) {
    try {
      const category = await HelpCenterService.createCategory(req.body);
      res.status(201).json(category);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}