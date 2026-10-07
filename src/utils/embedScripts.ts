import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { config } from '../config/index.js';

const cache = new Map<string, string>();

/**
 * Serves public/widget.js and public/subscribe.js with __APP_URL__ (dashboard /
 * widget host) and __API_URL__ (this API) substituted.
 */
export function serveEmbedScript(req: Request, res: Response): void {
  const name = path.basename(req.path);
  let body = cache.get(name);
  if (!body) {
    const file = path.join(process.cwd(), 'public', name);
    if (!fs.existsSync(file)) {
      res.status(404).end();
      return;
    }
    const apiUrl = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    body = fs
      .readFileSync(file, 'utf8')
      .replace(/__APP_URL__/g, config.frontendUrl.replace(/\/+$/, ''))
      .replace(/__API_URL__/g, apiUrl);
    if (config.nodeEnv === 'production') cache.set(name, body);
  }
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.send(body);
}
