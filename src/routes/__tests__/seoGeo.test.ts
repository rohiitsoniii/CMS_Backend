import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, authHeader, createProjectWithRoles } from '../../test/helpers.js';
import { Content } from '../../models/index.js';
import { NotFoundLog } from '../../models/Redirect.js';
import { analyzeGeo } from '../../services/geoService.js';

const app = createTestApp();

async function setup(email: string, slug: string) {
  const { auth } = await registerOwner(app, { email });
  const projectId = await createProjectWithRoles(app, auth!, slug);
  return { auth: auth!, projectId, headers: authHeader(auth!) };
}

describe('SEO suite — access control', () => {
  it('refuses another tenant on every SEO route', async () => {
    const a = await setup('seo-a@example.com', 'seo-a');
    const b = await setup('seo-b@example.com', 'seo-b');
    for (const path of ['settings', 'robots', 'redirects', 'geo', 'keywords']) {
      const res = await request(app).get(`/api/v1/projects/${a.projectId}/seo/${path}`).set(b.headers);
      expect(res.status, path).toBe(404);
    }
  });
});

describe('robots.txt, llms.txt, sitemap', () => {
  it('applies AI crawler policy and lists published content', async () => {
    const { auth, projectId, headers } = await setup('seo-c@example.com', 'seo-c');
    const saved = await request(app).put(`/api/v1/projects/${projectId}/seo/settings`).set(headers).send({
      siteUrl: 'https://www.acme.test/',
      siteName: 'Acme',
      aiCrawlers: { GPTBot: 'block', ClaudeBot: 'allow', NotARealBot: 'block' },
      llms: { enabled: true, summary: 'Acme sells rockets.' },
    });
    expect(saved.status).toBe(200);

    await Content.create({
      projectId, tenantId: auth.tenantId, type: 'blog', name: 'Rocket guide', slug: 'rocket-guide', status: 'published',
      data: { title: 'Rocket guide', excerpt: 'How to pick a rocket', content: '<p>Rockets are great.</p>' },
      createdBy: auth.userId,
    });
    await Content.create({
      projectId, tenantId: auth.tenantId, type: 'blog', name: 'Draft', slug: 'draft-post', status: 'draft',
      data: { title: 'Draft' }, createdBy: auth.userId,
    });

    const robots = await request(app).get(`/api/v1/public/seo/${projectId}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.text).toContain('User-agent: GPTBot\nDisallow: /');
    expect(robots.text).toContain('User-agent: ClaudeBot\nAllow: /');
    expect(robots.text).not.toContain('NotARealBot');
    expect(robots.text).toContain('Sitemap: https://www.acme.test/sitemap.xml');

    const llms = await request(app).get(`/api/v1/public/seo/${projectId}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(llms.text).toContain('# Acme');
    expect(llms.text).toContain('> Acme sells rockets.');
    expect(llms.text).toContain('[Rocket guide](https://www.acme.test/blog/rocket-guide)');
    expect(llms.text).not.toContain('draft-post');

    const sitemap = await request(app).get(`/api/v1/public/seo/${projectId}/sitemap.xml`);
    expect(sitemap.text).toContain('<loc>https://www.acme.test/blog/rocket-guide</loc>');
    expect(sitemap.text).not.toContain('draft-post');

    const meta = await request(app).get(`/api/v1/public/seo/${projectId}/meta`).query({ slug: 'rocket-guide' });
    expect(meta.status).toBe(200);
    expect(meta.body.data.canonical).toBe('https://www.acme.test/blog/rocket-guide');
    expect(meta.body.data.jsonLd['@graph'][0]['@type']).toBe('BlogPosting');
  });
});

describe('redirects & 404s', () => {
  it('resolves redirects and logs misses', async () => {
    const { projectId, headers } = await setup('seo-d@example.com', 'seo-d');
    const created = await request(app).post(`/api/v1/projects/${projectId}/seo/redirects`).set(headers)
      .send({ from: 'https://www.acme.test/Old-Page/?utm=x', to: '/new-page', statusCode: 301 });
    expect(created.status).toBe(201);
    expect(created.body.data.from).toBe('/old-page');

    const dup = await request(app).post(`/api/v1/projects/${projectId}/seo/redirects`).set(headers).send({ from: '/old-page', to: '/x' });
    expect(dup.status).toBe(409);

    const hit = await request(app).get(`/api/v1/public/seo/${projectId}/resolve`).query({ path: '/old-page' });
    expect(hit.body.data).toMatchObject({ type: 'redirect', statusCode: 301, to: '/new-page' });

    const miss = await request(app).get(`/api/v1/public/seo/${projectId}/resolve`).query({ path: '/missing', notFound: '1' });
    expect(miss.body.data.type).toBe('none');
    expect((await NotFoundLog.findOne({ projectId, path: '/missing' }))?.hits).toBe(1);
  });
});

describe('GEO analyzer', () => {
  it('rewards answer-first, structured, cited content', () => {
    const strong = analyzeGeo({
      type: 'blog',
      name: 'What is a headless CMS?',
      updatedAt: new Date(),
      seo: { metaTitle: 'What is a headless CMS?', metaDescription: 'A clear definition.' },
      data: {
        author: 'Ada Lovelace',
        content: `<p>A headless CMS stores content and delivers it through an API to any website or app, without a built-in front end.</p>
          <h2>How does a headless CMS work?</h2><p>It exposes content via REST or GraphQL. 73% of teams report faster launches and 2x more channels.</p>
          <h2>Why use a headless CMS?</h2><ul><li>Speed</li><li>Flexibility</li></ul>
          <p>Sources: <a href="https://www.gartner.com/report">Gartner</a> and <a href="https://jamstack.org/survey">Jamstack survey</a>, costs from $0 to $500 per month.</p>`
          + '<p>' + 'Headless platforms separate content from presentation so editors and developers can work independently. '.repeat(25) + '</p>',
      },
    });
    const weak = analyzeGeo({ type: 'blog', name: 'Post', data: { content: '<p>Short post.</p>' } });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.checks.find((c) => c.id === 'question_headings')?.passed).toBe(true);
    expect(strong.checks.find((c) => c.id === 'citations')?.passed).toBe(true);
    expect(weak.recommendations.length).toBeGreaterThan(0);
  });
});
