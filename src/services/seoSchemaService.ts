export class SeoSchemaService {
  /**
   * Generates JSON-LD for an Article/Blog post
   */
  public static generateArticleSchema(data: {
    headline: string;
    image?: string;
    authorName: string;
    publisherName: string;
    publisherLogo?: string;
    datePublished: string;
    dateModified: string;
    description: string;
  }) {
    return {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": data.headline,
      "image": data.image ? [data.image] : [],
      "datePublished": data.datePublished,
      "dateModified": data.dateModified,
      "author": [{
        "@type": "Person",
        "name": data.authorName,
      }],
      "publisher": {
        "@type": "Organization",
        "name": data.publisherName,
        "logo": {
          "@type": "ImageObject",
          "url": data.publisherLogo || ""
        }
      },
      "description": data.description
    };
  }

  /**
   * Generates FAQ Schema
   */
  public static generateFaqSchema(questions: { question: string, answer: string }[]) {
    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": questions.map(q => ({
        "@type": "Question",
        "name": q.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": q.answer
        }
      }))
    };
  }

  /**
   * Generates Breadcrumb Schema
   */
  public static generateBreadcrumbSchema(items: { name: string, item: string }[]) {
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": items.map((it, idx) => ({
        "@type": "ListItem",
        "position": idx + 1,
        "name": it.name,
        "item": it.item
      }))
    };
  }
}
