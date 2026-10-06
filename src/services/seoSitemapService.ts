import { Content } from '../models/Content';
import { Project } from '../models/Project';

export class SeoSitemapService {
  /**
   * Generates an XML sitemap for a specific project
   */
  public static async generateSitemap(projectId: string): Promise<string> {
    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    const domain = project.domain || 'http://localhost:3000'; // Fallback
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;

    const contents = await Content.find({
      projectId,
      status: 'published',
      isDeleted: false,
      'seo.noIndex': { $ne: true }
    }).select('slug updatedAt type');

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Add Home Page (default)
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString()}</lastmod>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    contents.forEach(content => {
      // Only include if it has a slug and is a page/blog or custom content meant for public consumption
      if (content.slug && ['blog', 'page', 'custom'].includes(content.type)) {
        const path = content.type === 'blog' ? `/blog/${content.slug}` : `/${content.slug}`;
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}${path}</loc>\n`;
        xml += `    <lastmod>${content.updatedAt.toISOString()}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += `    <priority>${content.type === 'page' ? '0.8' : '0.6'}</priority>\n`;
        xml += '  </url>\n';
      }
    });

    xml += '</urlset>';
    return xml;
  }
}
