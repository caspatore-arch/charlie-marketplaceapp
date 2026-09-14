/**
 * tRPC client + small HTTP helpers shared by every screen.
 *
 * NOTE for maintainers: this imports `type { AppRouter }` from
 * `@/backend/trpc/app-router`, which is being built concurrently by the
 * backend agent. If that file does not exist yet, typecheck will fail on
 * this import only — do not stub it out, just wait for the backend agent.
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpLink } from '@trpc/client';
import superjson from 'superjson';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AppRouter } from '@/backend/trpc/app-router';

export const trpc = createTRPCReact<AppRouter>();

const AUTH_TOKEN_KEY = 'campus-swap-auth-token';

/** Base URL of the backend API (no trailing slash), e.g. http://localhost:3000. */
export const apiBaseUrl: string =
  process.env.EXPO_PUBLIC_RORK_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

const trpcUrl = `${apiBaseUrl}/api/trpc`;

/** Reads the persisted bearer token (SecureStore native, AsyncStorage fallback on web). */
async function readToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    }
    return await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

export const authTokenStorageKey = AUTH_TOKEN_KEY;
/** Auth token persistence, shared by AuthProvider and the tRPC link's headers(). */
export const authStorage = { getToken: readToken, setToken: writeToken, clearToken };

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: trpcUrl,
      transformer: superjson,
      async headers() {
        const token = await readToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

/**
 * Resolves a listing/avatar photo URL. Backend returns relative paths like
 * `/api/uploads/xyz.jpg`; absolute URLs (e.g. seeded demo SVGs already
 * absolute, or future CDN URLs) pass through unchanged.
 */
export function resolveMediaUrl(relativeOrAbsolute: string | null | undefined): string | undefined {
  if (!relativeOrAbsolute) return undefined;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${apiBaseUrl}${path}`;
}

export type UploadProgressCallback = (progress: number) => void;

/**
 * Uploads a local image (from expo-image-picker) to `POST /api/uploads` as
 * multipart/form-data and returns the relative URL the server responds with.
 * Pass `onProgress` (0-1) for a progress bar; best-effort, not guaranteed on
 * every platform since we use fetch rather than a native upload task.
 */
export async function uploadImage(
  localUri: string,
  onProgress?: UploadProgressCallback,
): Promise<string> {
  const token = await readToken();
  const filename = localUri.split('/').pop() || `photo-${Date.now()}.jpg`;
  const match = /\.(\w+)$/.exec(filename);
  const ext = match?.[1]?.toLowerCase() ?? 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';

  const formData = new FormData();
  // React Native's FormData accepts this shape for file-like values.
  formData.append('file', {
    uri: localUri,
    name: filename,
    type: mimeType,
  } as unknown as Blob);

  onProgress?.(0);

  const response = await fetch(`${apiBaseUrl}/api/uploads`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  onProgress?.(1);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Upload failed with status ${response.status}`);
  }

  const data = (await response.json()) as { url: string };
  return data.url;
}
