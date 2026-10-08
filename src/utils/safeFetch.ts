import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * Outbound HTTP for URLs supplied by customers (site audit, chatbot crawler,
 * webhooks, deploy hooks). Blocks private/internal addresses (SSRF), checks
 * every redirect hop, and validates the IP actually connected to (defeats
 * DNS rebinding). Set ALLOW_PRIVATE_NETWORK_FETCH=true for self-hosted setups
 * that need to call internal services.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_NETWORK_FETCH === 'true';

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast / reserved
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

/** DNS lookup that refuses private addresses — used by the HTTP agents. */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    if (!allowPrivate()) {
      const bad = list.find((a) => isPrivateIp(a.address));
      if (bad) return callback(new BlockedUrlError(`Refusing to connect to private address ${bad.address}`) as any, '', 4);
    }
    if ((options as any).all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const httpAgent = new http.Agent({ lookup: safeLookup as any, keepAlive: false });
const httpsAgent = new https.Agent({ lookup: safeLookup as any, keepAlive: false });

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new BlockedUrlError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new BlockedUrlError('URLs with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate()) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
      throw new BlockedUrlError('Internal hostnames are not allowed');
    }
    if (net.isIP(host) && isPrivateIp(host)) throw new BlockedUrlError('Private IP addresses are not allowed');
  }
  return url;
}

const MAX_REDIRECTS = 5;

/**
 * Like axios.request, restricted to public hosts. Redirects are followed
 * manually so every hop is validated.
 */
export async function safeRequest<T = any>(config: AxiosRequestConfig & { url: string }): Promise<AxiosResponse<T>> {
  let url = config.url;
  let method = (config.method || 'get').toLowerCase();
  let data = config.data;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(url);
    const res = await axios.request<T>({
      timeout: 15_000,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
      ...config,
      url,
      method,
      data,
      maxRedirects: 0,
      httpAgent,
      httpsAgent,
      proxy: false,
      validateStatus: (s) => s < 400 || (config.validateStatus ? config.validateStatus(s) : false),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'post')) {
        method = 'get';
        data = undefined;
      }
      continue;
    }
    return res;
  }
  throw new BlockedUrlError('Too many redirects');
}

export const safeGet = <T = any>(url: string, config: AxiosRequestConfig = {}) => safeRequest<T>({ ...config, url, method: 'get' });
export const safePost = <T = any>(url: string, data?: any, config: AxiosRequestConfig = {}) => safeRequest<T>({ ...config, url, data, method: 'post' });
