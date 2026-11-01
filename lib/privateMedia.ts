/**
 * Uploads a photo or short video for a "Get a Dibbs offer" request to
 * `POST /api/private-media`. Unlike listing photos, these are private: the
 * server returns an id plus a short-lived signed link, and the request claims
 * the id on submit. Uses XMLHttpRequest because fetch has no upload progress.
 *
 * Limits mirror backend/dibbs/media.ts (the server re-checks everything):
 * photos JPEG/PNG/WebP/HEIC up to 8 MB; one MP4/MOV video up to 50 MB and 30 s.
 */
import { Platform } from 'react-native';

import { apiBaseUrl, authStorage } from '@/lib/trpc';

export const PRIVATE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PRIVATE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const PRIVATE_VIDEO_MAX_SECONDS = 30;
export const MAX_REQUEST_PHOTOS = 8;
export const MAX_REQUEST_VIDEOS = 1;

export interface UploadedPrivateMedia {
  id: string;
  kind: 'image' | 'video';
  durationMs: number | null;
  /** Relative signed path; render through resolveMediaUrl. Expires after about an hour. */
  url: string;
}

export interface PrivateUploadInput {
  uri: string;
  kind: 'image' | 'video';
  /** From expo-image-picker's asset.mimeType when known. */
  mimeType?: string | null;
  fileName?: string | null;
}

function guessMime(input: PrivateUploadInput): string {
  if (input.mimeType) return input.mimeType.toLowerCase();
  const ext = /\.(\w+)(?:\?|$)/.exec(input.fileName ?? input.uri)?.[1]?.toLowerCase();
  if (input.kind === 'video') return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

/** Rejects with an Error whose message is safe to show. `onProgress` gets 0..1. */
export async function uploadPrivateMedia(
  input: PrivateUploadInput,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<UploadedPrivateMedia> {
  const token = await authStorage.getToken();
  const type = guessMime(input);
  const name = input.fileName || `${input.kind}-${Date.now()}.${input.kind === 'video' ? 'mp4' : 'jpg'}`;
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await fetch(input.uri).then((r) => r.blob());
    form.append('file', new File([blob], name, { type: blob.type || type }));
  } else {
    form.append('file', { uri: input.uri, name, type } as unknown as Blob);
  }

  return new Promise<UploadedPrivateMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBaseUrl}/api/private-media`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(0.99, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: { error?: string } & Partial<UploadedPrivateMedia> = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        // fall through to the generic message
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id && body.url && body.kind) {
        onProgress?.(1);
        resolve({ id: body.id, kind: body.kind, durationMs: body.durationMs ?? null, url: body.url });
      } else {
        reject(new Error(body.error || `Upload failed (${xhr.status}). Try again.`));
      }
    };
    xhr.onerror = () => reject(new Error("Can't reach the server. Check your connection and try again."));
    xhr.ontimeout = () => reject(new Error('The upload timed out. Try again on a stronger connection.'));
    xhr.timeout = 5 * 60_000;
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    onProgress?.(0);
    xhr.send(form);
  });
}
