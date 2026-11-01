/**
 * Private media for "Get a Dibbs offer" requests.
 *
 * Kept apart from public listing photos on purpose: `GET /api/uploads/:name`
 * serves any public file by name with no sign-in, so private files never go
 * there. They live in their own directory (local) or bucket (S3) and are read
 * only through `GET /api/private-media/:id?e=&s=`, a short-lived HMAC-signed
 * link that the server hands out to the request's seller or to Dibbs staff.
 * Signed links (rather than auth headers) are used because a web <img> or
 * <video> cannot send an Authorization header.
 *
 * Limits: photos JPEG/PNG/WebP/HEIC up to 8 MB; one video MP4/MOV up to
 * 50 MB and 30 seconds. The file's first bytes must match its claimed type,
 * and a video's length is read from its own header (not trusted from the app).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../env';

export const PRIVATE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PRIVATE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const PRIVATE_VIDEO_MAX_MS = 30_000;
/** Photos per request (a video counts separately). */
export const MAX_PHOTOS_PER_REQUEST = 8;
export const MAX_VIDEOS_PER_REQUEST = 1;
/** Signed links last this long; the app re-fetches the request to get fresh ones. */
export const SIGNED_URL_TTL_MS = 60 * 60 * 1000;
/** Private uploads per person per rolling day (storage abuse brake). */
export const MAX_UNATTACHED_UPLOADS_PER_DAY = 40;

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heic',
};
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

export type MediaKind = 'image' | 'video';

export class PrivateMediaError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 | 503 = 400,
  ) {
    super(message);
  }
}

export function kindForContentType(contentType: string): MediaKind | null {
  const t = contentType.toLowerCase();
  if (t in IMAGE_TYPES) return 'image';
  if (t in VIDEO_TYPES) return 'video';
  return null;
}

/** True when the leading bytes look like the claimed type. */
export function sniffMatches(bytes: Buffer, contentType: string): boolean {
  const t = contentType.toLowerCase();
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (bytes.length < 12) return false;
  if (t === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (t === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (t === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (t === 'image/heic' || t === 'image/heif') {
    return ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(8, 12));
  }
  if (t === 'video/mp4' || t === 'video/quicktime') {
    // ISO base media / QuickTime: a box type at offset 4.
    return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(4, 8));
  }
  return false;
}

/**
 * Reads a video's length from the `moov/mvhd` box (MP4 and MOV share it).
 * Returns null when the header can't be found or read.
 */
export function videoDurationMs(bytes: Buffer): number | null {
  const findBox = (start: number, end: number, type: string): { body: number; end: number } | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = bytes.readUInt32BE(at);
      const boxType = bytes.subarray(at + 4, at + 8).toString('latin1');
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return null;
        const big = bytes.readBigUInt64BE(at + 8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(big);
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return null;
      if (boxType === type) return { body: at + header, end: at + size };
      at += size;
    }
    return null;
  };
  try {
    const moov = findBox(0, bytes.length, 'moov');
    if (!moov) return null;
    const mvhd = findBox(moov.body, moov.end, 'mvhd');
    if (!mvhd) return null;
    const version = bytes[mvhd.body];
    let timescale: number;
    let duration: number;
    if (version === 1) {
      timescale = bytes.readUInt32BE(mvhd.body + 20);
      duration = Number(bytes.readBigUInt64BE(mvhd.body + 24));
    } else {
      timescale = bytes.readUInt32BE(mvhd.body + 12);
      duration = bytes.readUInt32BE(mvhd.body + 16);
    }
    if (!timescale || !Number.isFinite(duration)) return null;
    return Math.round((duration / timescale) * 1000);
  } catch {
    return null;
  }
}

export interface ValidatedMedia {
  kind: MediaKind;
  contentType: string;
  ext: string;
  durationMs: number | null;
}

/** Throws PrivateMediaError with a message the app can show as-is. */
export function validatePrivateMedia(bytes: Buffer, claimedType: string): ValidatedMedia {
  const contentType = claimedType.toLowerCase();
  const kind = kindForContentType(contentType);
  if (!kind) {
    throw new PrivateMediaError('That file type is not supported. Use a photo (JPEG, PNG, WebP, HEIC) or an MP4/MOV video.', 415);
  }
  if (kind === 'image' && bytes.byteLength > PRIVATE_IMAGE_MAX_BYTES) {
    throw new PrivateMediaError('That photo is larger than 8 MB. Try a smaller one.', 413);
  }
  if (kind === 'video' && bytes.byteLength > PRIVATE_VIDEO_MAX_BYTES) {
    throw new PrivateMediaError('That video is larger than 50 MB. Record a shorter clip (30 seconds or less).', 413);
  }
  if (!sniffMatches(bytes, contentType)) {
    throw new PrivateMediaError("That file doesn't look like a photo or video we can use. Try taking it again.", 415);
  }
  let durationMs: number | null = null;
  if (kind === 'video') {
    durationMs = videoDurationMs(bytes);
    if (durationMs == null) {
      throw new PrivateMediaError("We couldn't read that video's length. Record it again with the Camera app.", 415);
    }
    if (durationMs > PRIVATE_VIDEO_MAX_MS + 500) {
      throw new PrivateMediaError('Videos can be up to 30 seconds. Trim it or record a shorter clip.', 400);
    }
  }
  const ext = kind === 'image' ? IMAGE_TYPES[contentType]! : VIDEO_TYPES[contentType]!;
  return { kind, contentType: contentType === 'image/heif' ? 'image/heic' : contentType, ext, durationMs };
}

/* ---------------------------------------------------------------- storage */

interface PrivateStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^private\/[0-9a-f-]{36}\.(jpg|png|webp|heic|mp4|mov)$/;

class LocalPrivateStore implements PrivateStore {
  private file(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Bad private media key');
    return path.join(path.resolve(env.privateUploadsDir), key.slice('private/'.length));
  }
  async put(key: string, bytes: Buffer) {
    const full = this.file(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async remove(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

class S3PrivateStore implements PrivateStore {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint,
      forcePathStyle: Boolean(env.s3Endpoint),
      credentials: { accessKeyId: env.s3AccessKeyId!, secretAccessKey: env.s3SecretAccessKey! },
    });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch {
      return null;
    }
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }
}

/**
 * Local disk when S3 is off. With S3: S3_PRIVATE_BUCKET if set; otherwise the
 * main bucket, but only while it is private (no S3_PUBLIC_BASE_URL). A public
 * main bucket and no private bucket = private uploads are refused (503).
 */
function pickStore(): PrivateStore | null {
  if (!env.s3Bucket) return new LocalPrivateStore();
  if (env.s3PrivateBucket) return new S3PrivateStore(env.s3PrivateBucket);
  if (!env.s3PublicBaseUrl) return new S3PrivateStore(env.s3Bucket);
  return null;
}

let store: PrivateStore | null | undefined;
function privateStore(): PrivateStore {
  if (store === undefined) store = pickStore();
  if (!store) {
    throw new PrivateMediaError('Private uploads are not set up on this server yet. Please try again later.', 503);
  }
  return store;
}

export function newPrivateKey(ext: string): string {
  return `private/${crypto.randomUUID()}${ext}`;
}

export async function putPrivate(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await privateStore().put(key, bytes, contentType);
}

export async function getPrivate(key: string): Promise<Buffer | null> {
  return privateStore().get(key);
}

export async function removePrivate(key: string): Promise<void> {
  await privateStore().remove(key);
}

/* ------------------------------------------------------------ signed links */

const processSecret = crypto.randomBytes(32).toString('hex');
function secret(): string {
  return env.privateMediaSecret ?? processSecret;
}

function signature(mediaId: string, expiresAtSec: number): string {
  return crypto.createHmac('sha256', secret()).update(`dibbs-private-media:v1:${mediaId}:${expiresAtSec}`).digest('base64url');
}

/** Relative signed path; render through resolveMediaUrl like any other media path. */
export function signedMediaPath(mediaId: string, now: number = Date.now()): string {
  // Round the expiry to the minute so repeated reads return the same URL (image caches keep working).
  const exp = Math.floor((now + SIGNED_URL_TTL_MS) / 60_000) * 60;
  return `/api/private-media/${mediaId}?e=${exp}&s=${signature(mediaId, exp)}`;
}

export function verifySignedMedia(mediaId: string, e: string | undefined, s: string | undefined, now: number = Date.now()): boolean {
  if (!e || !s || !/^\d{1,12}$/.test(e)) return false;
  const exp = Number(e);
  if (exp * 1000 < now) return false;
  const expected = Buffer.from(signature(mediaId, exp));
  const given = Buffer.from(s);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
