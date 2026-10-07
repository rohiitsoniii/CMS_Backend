import axios from 'axios';
import { IKeywordRank } from '../models/KeywordRank.js';

/**
 * Real keyword positions from Google results via Serper.dev
 * (set SERPER_API_KEY). Position 0 = not in the top 100.
 */

export const rankProviderConfigured = () => Boolean(process.env.SERPER_API_KEY);

export async function checkKeywordRank(kw: IKeywordRank, siteUrl: string, opts: { gl?: string; hl?: string } = {}) {
  const host = new URL(siteUrl).host.replace(/^www\./, '');
  const res = await axios.post(
    'https://google.serper.dev/search',
    { q: kw.keyword, gl: opts.gl || 'us', hl: opts.hl || 'en', num: 100 },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' }, timeout: 30_000 }
  );
  const organic: Array<{ link: string; position: number }> = res.data?.organic || [];
  const hit = organic.find((r) => {
    try {
      return new URL(r.link).host.replace(/^www\./, '') === host;
    } catch {
      return false;
    }
  });
  const rank = hit?.position || 0;

  kw.currentRank = rank;
  if (rank > 0 && (!kw.bestRank || rank < kw.bestRank)) kw.bestRank = rank;
  kw.rankHistory.push({ rank, checkedAt: new Date() });
  if (kw.rankHistory.length > 365) kw.rankHistory = kw.rankHistory.slice(-365);
  if (hit && !kw.targetUrl) kw.targetUrl = hit.link;
  await kw.save();

  return { rank, url: hit?.link || null, checkedAt: new Date() };
}
