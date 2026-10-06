import { HelpArticle, HelpCategory } from '../models/HelpCenter.js';
import { v4 as uuidv4 } from 'uuid';

export class HelpCenterService {
  static async getCategories() {
    return HelpCategory.find().sort({ order: 1 });
  }

  static async getCategoryBySlug(slug: string) {
    return HelpCategory.findOne({ slug });
  }

  static async getArticlesByCategory(categorySlug: string, filters: any = {}) {
    const category = await HelpCategory.findOne({ slug: categorySlug });
    if (!category) throw new Error('Category not found');

    const query: any = { category: categorySlug };
    if (filters.published !== false) query.isPublished = true;

    return HelpArticle.find(query).sort({ isFeatured: -1, createdAt: -1 });
  }

  static async getArticleBySlug(slug: string) {
    const article = await HelpArticle.findOne({ slug, isPublished: true })
      .populate('author', 'name email');
    
    if (article) {
      article.viewCount += 1;
      await article.save();
    }
    
    return article;
  }

  static async searchArticles(query: string, limit: number = 10) {
    return HelpArticle.find(
      { $text: { $search: query }, isPublished: true },
      { score: { $meta: 'textScore' } }
    )
    .sort({ score: { $meta: 'textScore' }, viewCount: -1 })
    .limit(limit);
  }

  static async createArticle(data: {
    title: string;
    content: string;
    category: string;
    tags?: string[];
    authorId: string;
  }) {
    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + uuidv4().slice(0, 8);

    const article = await HelpArticle.create({
      ...data,
      slug,
      author: data.authorId
    });

    await HelpCategory.findOneAndUpdate(
      { slug: data.category },
      { $inc: { articleCount: 1 } }
    );

    return article;
  }

  static async updateArticle(slug: string, updates: any) {
    return HelpArticle.findOneAndUpdate(
      { slug },
      { $set: updates },
      { new: true }
    );
  }

  static async deleteArticle(slug: string) {
    const article = await HelpArticle.findOne({ slug });
    if (!article) throw new Error('Article not found');

    await HelpCategory.findOneAndUpdate(
      { slug: article.category },
      { $inc: { articleCount: -1 } }
    );

    return HelpArticle.deleteOne({ slug });
  }

  static async markHelpful(articleSlug: string, helpful: boolean) {
    const update = helpful 
      ? { $inc: { helpfulCount: 1 } }
      : { $inc: { notHelpfulCount: 1 } };

    return HelpArticle.findOneAndUpdate({ slug: articleSlug }, update);
  }

  static async getPopularArticles(limit: number = 5) {
    return HelpArticle.find({ isPublished: true })
      .sort({ viewCount: -1 })
      .limit(limit)
      .select('title slug viewCount');
  }

  static async getRelatedArticles(articleSlug: string, limit: number = 3) {
    const article = await HelpArticle.findOne({ slug: articleSlug });
    if (!article) return [];

    return HelpArticle.find({
      _id: { $ne: article._id },
      category: article.category,
      isPublished: true
    })
    .limit(limit)
    .select('title slug');
  }

  static async createCategory(data: {
    name: string;
    description: string;
    icon?: string;
    order?: number;
  }) {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return HelpCategory.create({ ...data, slug });
  }
}