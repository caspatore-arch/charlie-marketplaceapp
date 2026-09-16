/**
 * Upload storage adapter. LocalDiskStorage writes under backend/data/uploads
 * and the Hono app serves those bytes back at GET /api/uploads/:name.
 *
 * S3Storage is the deployable alternative: any S3-compatible provider (AWS
 * S3, Cloudflare R2, Backblaze B2, Wasabi, ...) via an optional endpoint
 * override. The adapter is chosen once at module load by `storage`, below,
 * based purely on whether S3_BUCKET is set — see `pickStorage()`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { env, validateS3Env } from './env';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/** Types accepted from user uploads. */
export const USER_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/** SVG is allowed for storage (seeded demo art) but rejected on user upload. */
export const ALLOWED_CONTENT_TYPES = [...USER_CONTENT_TYPES, 'image/svg+xml'] as const;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/svg+xml': '.svg',
};

const TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
};

export type StoredFile = { bytes: Buffer; contentType: string };

export interface StorageAdapter {
  put(name: string, bytes: Buffer, contentType: string): Promise<{ url: string }>;
  get(name: string): Promise<StoredFile | null>;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/**
 * Reduce an arbitrary client-supplied name to a safe basename:
 * no directories, no traversal, lowercase, `[a-z0-9._-]` only.
 */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name ?? '').trim().toLowerCase();
  const cleaned = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  return cleaned.slice(0, 80);
}

export function contentTypeForName(name: string): string {
  return TYPE_BY_EXTENSION[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly dir: string = env.uploadsDir) {}

  private resolve(name: string): string {
    const safe = sanitizeFileName(name);
    if (!safe) throw new UploadError('That file name is not allowed.');
    return path.join(path.resolve(this.dir), safe);
  }

  async put(name: string, bytes: Buffer, contentType: string): Promise<{ url: string }> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new UploadError('That image is larger than 8 MB. Try a smaller one.', 413);
    }
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new UploadError('That file type is not supported. Use a JPEG, PNG, WebP or HEIC.', 415);
    }

    // Always store under a name we generate — keeps the original only as a hint.
    const hinted = sanitizeFileName(name);
    const ext = EXTENSION_BY_TYPE[contentType] ?? path.extname(hinted) ?? '';
    const stored =
      hinted && hinted.endsWith(ext) && hinted.startsWith('demo-')
        ? hinted // seed writes stable demo-*.svg names so re-seeding is idempotent
        : `${crypto.randomUUID()}${ext}`;

    const full = this.resolve(stored);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return { url: `/api/uploads/${stored}` };
  }

  async get(name: string): Promise<StoredFile | null> {
    let full: string;
    try {
      full = this.resolve(name);
    } catch {
      return null;
    }
    try {
      const bytes = await fs.readFile(full);
      return { bytes, contentType: contentTypeForName(full) };
    } catch {
      return null;
    }
  }
}

/**
 * S3-compatible storage. Works against AWS S3 and any S3-compatible provider
 * (Cloudflare R2, Backblaze B2, Wasabi, ...) by setting `S3_ENDPOINT`.
 *
 * Serving strategy for `GET /api/uploads/:name`: when `S3_PUBLIC_BASE_URL`
 * is set, `put()` returns a URL pointing straight at it (a CDN/public bucket
 * URL or custom domain) and the app never proxies bytes through the backend
 * — cheaper and faster, the provider serves the image directly. When it is
 * NOT set, `get()` streams the object through the backend so uploads work
 * out of the box on a private bucket with zero extra configuration; this
 * costs the backend's own bandwidth so set S3_PUBLIC_BASE_URL once you have
 * a public bucket/CDN in front of the bucket.
 */
export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;

  constructor() {
    if (!env.s3Bucket || !env.s3Region || !env.s3AccessKeyId || !env.s3SecretAccessKey) {
      // validateS3Env() should have already thrown at startup with a precise
      // message; this is a defense-in-depth guard against constructing the
      // adapter directly (e.g. from a test) without validation having run.
      throw new Error('S3Storage requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
    }
    this.bucket = env.s3Bucket;
    this.publicBaseUrl = env.s3PublicBaseUrl;
    this.client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint, // undefined = real AWS S3
      // Path-style addressing is required by most non-AWS S3-compatible
      // providers (R2, B2, MinIO); AWS S3 also accepts it, so it is safe to
      // always set it when a custom endpoint is in play.
      forcePathStyle: Boolean(env.s3Endpoint),
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  }

  async put(name: string, bytes: Buffer, contentType: string): Promise<{ url: string }> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new UploadError('That image is larger than 8 MB. Try a smaller one.', 413);
    }
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new UploadError('That file type is not supported. Use a JPEG, PNG, WebP or HEIC.', 415);
    }

    const hinted = sanitizeFileName(name);
    const ext = EXTENSION_BY_TYPE[contentType] ?? path.extname(hinted) ?? '';
    const key =
      hinted && hinted.endsWith(ext) && hinted.startsWith('demo-')
        ? hinted // seed writes stable demo-*.svg names so re-seeding is idempotent
        : `${crypto.randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );

    const url = this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `/api/uploads/${key}`;
    return { url };
  }

  async get(name: string): Promise<StoredFile | null> {
    const key = sanitizeFileName(name);
    if (!key) return null;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      return { bytes, contentType: result.ContentType ?? contentTypeForName(key) };
    } catch {
      // Covers NoSuchKey and any other SDK error — proxy consumers only care
      // whether the object exists, not why the fetch failed.
      return null;
    }
  }
}

function pickStorage(): StorageAdapter {
  // Validated here (module load, i.e. process startup via the hono.ts import
  // chain) rather than in backend/server.ts, which this task does not own:
  // fail fast and loudly before the server starts accepting traffic.
  validateS3Env();
  return env.s3Bucket ? new S3Storage() : new LocalDiskStorage();
}

export const storage: StorageAdapter = pickStorage();
