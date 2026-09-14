/**
 * Upload storage adapter. LocalDiskStorage writes under backend/data/uploads
 * and the Hono app serves those bytes back at GET /api/uploads/:name.
 * Swapping in S3-compatible storage means implementing StorageAdapter only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from './env';

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

export const storage: StorageAdapter = new LocalDiskStorage();
