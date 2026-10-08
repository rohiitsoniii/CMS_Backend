import fs from 'fs/promises';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

/**
 * Object storage for files that must survive server loss (backups, exports).
 *
 *   STORAGE_DRIVER=local (default) → files under ./storage-root (process.cwd())
 *   STORAGE_DRIVER=s3              → any S3-compatible service:
 *       S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *       S3_ENDPOINT (R2 / Spaces / MinIO), S3_FORCE_PATH_STYLE=true (MinIO)
 */

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface ObjectStorage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer | string, opts?: { contentType?: string; metadata?: Record<string, string> }): Promise<{ size: number }>;
  get(key: string): Promise<Buffer | null>;
  readStart(key: string, bytes: number): Promise<Buffer | null>;
  head(key: string): Promise<{ size: number; lastModified: Date; metadata: Record<string, string> } | null>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<StoredObject[]>;
}

function assertKey(key: string) {
  if (!key || key.includes('\0') || key.split('/').some((seg) => seg === '..' || seg === '') || key.startsWith('/')) {
    throw new Error('Invalid storage key');
  }
}

class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  constructor(private root: string) {}

  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer | string) {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    const stat = await fs.stat(file);
    return { size: stat.size };
  }

  async get(key: string) {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async readStart(key: string, bytes: number) {
    let handle;
    try {
      handle = await fs.open(this.resolve(key), 'r');
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    } finally {
      await handle?.close();
    }
  }

  async head(key: string) {
    try {
      const stat = await fs.stat(this.resolve(key));
      return { size: stat.size, lastModified: stat.mtime, metadata: {} };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string) {
    try {
      await fs.unlink(this.resolve(key));
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  }

  async list(prefix: string) {
    const dir = this.resolve(prefix.replace(/\/+$/, ''));
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    const out: StoredObject[] = [];
    for (const name of entries) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isFile()) out.push({ key: `${prefix.replace(/\/+$/, '')}/${name}`, size: stat.size, lastModified: stat.mtime });
    }
    return out;
  }
}

class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      region: process.env.S3_REGION || process.env.AWS_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' }
        : undefined,
    });
  }

  private isMissing(err: any) {
    return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
  }

  async put(key: string, body: Buffer | string, opts: { contentType?: string; metadata?: Record<string, string> } = {}) {
    assertKey(key);
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: buf, ContentType: opts.contentType, Metadata: opts.metadata,
      ServerSideEncryption: process.env.S3_SSE === 'false' ? undefined : 'AES256',
    }));
    return { size: buf.length };
  }

  async get(key: string) {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (this.isMissing(err)) return null;
      throw err;
    }
  }

  async readStart(key: string, bytes: number) {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (this.isMissing(err)) return null;
      throw err;
    }
  }

  async head(key: string) {
    assertKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength || 0, lastModified: res.LastModified || new Date(0), metadata: res.Metadata || {} };
    } catch (err) {
      if (this.isMissing(err)) return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertKey(key);
    const existed = await this.head(key);
    if (!existed) return false;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return true;
  }

  async list(prefix: string) {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`, ContinuationToken: token }));
      for (const o of res.Contents || []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size || 0, lastModified: o.LastModified || new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

let instance: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (instance) return instance;
  if (process.env.STORAGE_DRIVER === 's3') {
    if (!process.env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    instance = new S3Storage(process.env.S3_BUCKET);
  } else {
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ STORAGE_DRIVER is local — backups live on this server only. Set STORAGE_DRIVER=s3 for durable storage.');
    }
    instance = new LocalStorage(process.cwd());
  }
  return instance;
}

/** Test hook */
export function resetObjectStorage() {
  instance = null;
}
