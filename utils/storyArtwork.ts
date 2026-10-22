/**
 * "Story artwork": a vertical 1080x1920 (9:16) PNG of a freshly posted listing,
 * for the person to save or share and add to their OWN Instagram/Snapchat story.
 * Dibbs cannot post to anyone's story, so nothing here claims it did.
 *
 * The picture is: brand-red ground, the shipped white lockup, then one white
 * card holding the cover photo (cover-cropped, rounded), the price and the
 * title (max 2 lines, ellipsized). Colours are theme tokens only.
 *
 * Web draws it with a 2D canvas (this file). Native draws the same geometry
 * with react-native-svg (components/share/StoryArtwork.tsx) because there is no
 * canvas; both read `storyLayout` and `wrapTitle` so they cannot drift apart.
 * Nothing runs until the person asks for the image.
 */
import { Platform, Share } from 'react-native';
import { colors, fontFamilyFor } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
/** The shipped white-script lockup (transparent PNG, so it needs the red ground). */
export const STORY_LOGO = require('../assets/branding/dibbs-lockup-white.png');

const LOGO_RATIO = 1100 / 566; // must match the shipped file, as in components/ui/Logo.tsx

export interface StoryListing {
  title: string;
  priceCents: number;
  /** Absolute photo URL (pass through `resolveMediaUrl`), or null. */
  photoUrl: string | null;
}

/** Width of `text` at `fontSize`, in artwork pixels. */
export type Measure = (text: string, fontSize: number) => number;

const TITLE_SIZE = 58;
const TITLE_LINE_HEIGHT = 72;
const TITLE_MAX_LINES = 2;
const PRICE_SIZE = 144;
const TEXT_X = 120;
const TEXT_MAX_WIDTH = 840;

/**
 * Geometry for a title of `titleLines` lines. The card is always the same size:
 * a one-line title just gives its spare line to the photo.
 */
export function storyLayout(titleLines: number) {
  const photoH = 780 + (titleLines <= 1 ? TITLE_LINE_HEIGHT : 0);
  const logoW = 480;
  const photo = { x: 108, y: 468, w: 864, h: photoH, r: 36 };
  const priceBaseline = photo.y + photo.h + 148;
  return {
    logo: { x: (STORY_WIDTH - logoW) / 2, y: 170, w: logoW, h: Math.round(logoW / LOGO_RATIO) },
    card: { x: 80, y: 440, w: 920, h: 1170, r: 56 },
    photo,
    priceBaseline,
    titleBaseline: priceBaseline + 82,
    titleLineHeight: TITLE_LINE_HEIGHT,
    titleSize: TITLE_SIZE,
    textX: TEXT_X,
  };
}

/** Largest price size (<= 144) that fits the card, so "$12,345.67" never overflows. */
export function fitPriceSize(price: string, measure: Measure): number {
  let size = PRICE_SIZE;
  while (size > 72 && measure(price, size) > TEXT_MAX_WIDTH) size -= 6;
  return size;
}

function fitLine(text: string, measure: (t: string) => number): string {
  if (measure(text) <= TEXT_MAX_WIDTH) return text;
  let end = text.length;
  while (end > 1 && measure(`${text.slice(0, end).trimEnd()}…`) > TEXT_MAX_WIDTH) end -= 1;
  const cut = text.slice(0, end);
  // Prefer to stop after a whole word; only a single over-long word is cut mid-way.
  const lastSpace = cut.lastIndexOf(' ');
  const out = text[end] === ' ' || lastSpace <= 0 ? cut : cut.slice(0, lastSpace);
  return `${out.trimEnd()}…`;
}

/** Greedy word wrap into at most 2 lines; whatever does not fit ends in an ellipsis. */
export function wrapTitle(title: string, measure: Measure): string[] {
  const words = title.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const at = (t: string) => measure(t, TITLE_SIZE);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && at(candidate) > TEXT_MAX_WIDTH) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  if (lines.length <= TITLE_MAX_LINES) return lines.map((l) => fitLine(l, at));
  // Too long: keep the first line, and let the second absorb the rest so its ellipsis is honest.
  const rest = lines.slice(TITLE_MAX_LINES - 1).join(' ');
  return [...lines.slice(0, TITLE_MAX_LINES - 1).map((l) => fitLine(l, at)), fitLine(rest, at)];
}

/** Rough width where there is no text measurer (native SVG). Errs wide, so lines wrap early rather than overflow. */
export const estimateMeasure: Measure = (text, fontSize) => text.length * fontSize * 0.62;

export function storyPriceText(priceCents: number): string {
  return formatPrice(priceCents);
}

export function storyFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `dibbs-story-${slug || 'listing'}.png`;
}

// ---------------------------------------------------------------- web (canvas)

/** What went wrong, so the screen can say something friendly instead of crashing. */
export class StoryArtworkError extends Error {
  constructor(
    readonly reason: 'photo' | 'logo' | 'canvas',
    message: string,
  ) {
    super(message);
    this.name = 'StoryArtworkError';
  }
}

function loadImage(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

/**
 * The bundled lockup's URL on web. Depending on the bundler `require(png)` is
 * either `{ uri }` (Metro dev server) or an asset id, which is resolved the way
 * react-native-web's <Image> does.
 */
function webLogoUrl(): string {
  const src: unknown = STORY_LOGO;
  if (src && typeof src === 'object' && typeof (src as { uri?: unknown }).uri === 'string') return (src as { uri: string }).uri;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getAssetByID } = require('@react-native/assets-registry/registry');
  const asset = getAssetByID(src as number);
  return `${asset.httpServerLocation}/${asset.name}.${asset.type}`;
}

/**
 * The photo comes from the API origin, so a canvas may only use it if CORS allows
 * it (otherwise toBlob throws a security error). Try a CORS <img> first, then a
 * fetched blob; both need the server's Access-Control-Allow-Origin.
 */
async function loadPhotoForCanvas(url: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(url, 'anonymous');
  } catch {
    // Fall through: a cached non-CORS copy of the same URL can make the <img> route fail.
  }
  const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
  if (!res.ok) throw new Error(`photo request failed (${res.status})`);
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await loadImage(objectUrl);
  } finally {
    // The decoded bitmap stays usable after the URL is released.
    URL.revokeObjectURL(objectUrl);
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the artwork and returns it as a 1080x1920 PNG. Web only. */
export async function renderStoryPngWeb(story: StoryListing): Promise<Blob> {
  const bold = fontFamilyFor('700');
  const semibold = fontFamilyFor('600');
  // Make sure Montserrat is ready before measuring; if it is not, the system fallback still works.
  try {
    await Promise.all([document.fonts.load(`40px ${bold}`), document.fonts.load(`40px ${semibold}`)]);
  } catch {
    // ignore
  }

  let logo: HTMLImageElement;
  try {
    logo = await loadImage(webLogoUrl());
  } catch {
    throw new StoryArtworkError('logo', 'Could not load the Dibbs logo.');
  }
  let photo: HTMLImageElement | null = null;
  if (story.photoUrl) {
    try {
      photo = await loadPhotoForCanvas(story.photoUrl);
    } catch {
      throw new StoryArtworkError('photo', 'Could not load the listing photo for the canvas.');
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new StoryArtworkError('canvas', 'Canvas is not available.');

  // Family-specific faces (no `bold` keyword): the app loads one family per weight.
  const measure: Measure = (text, size) => {
    ctx.font = `${size}px ${semibold}`;
    return ctx.measureText(text).width;
  };
  const lines = wrapTitle(story.title, measure);
  const L = storyLayout(lines.length);

  ctx.fillStyle = colors.brand;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  ctx.drawImage(logo, L.logo.x, L.logo.y, L.logo.w, L.logo.h);

  ctx.fillStyle = colors.surface;
  roundRectPath(ctx, L.card.x, L.card.y, L.card.w, L.card.h, L.card.r);
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, L.photo.x, L.photo.y, L.photo.w, L.photo.h, L.photo.r);
  ctx.clip();
  if (photo) {
    // Cover crop: fill the box, centre what overflows.
    const scale = Math.max(L.photo.w / photo.naturalWidth, L.photo.h / photo.naturalHeight);
    const sw = L.photo.w / scale;
    const sh = L.photo.h / scale;
    ctx.drawImage(
      photo,
      (photo.naturalWidth - sw) / 2,
      (photo.naturalHeight - sh) / 2,
      sw,
      sh,
      L.photo.x,
      L.photo.y,
      L.photo.w,
      L.photo.h,
    );
  } else {
    ctx.fillStyle = colors.surfaceMuted;
    ctx.fillRect(L.photo.x, L.photo.y, L.photo.w, L.photo.h);
  }
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const price = storyPriceText(story.priceCents);
  const priceSize = fitPriceSize(price, (t, s) => {
    ctx.font = `${s}px ${bold}`;
    return ctx.measureText(t).width;
  });
  ctx.font = `${priceSize}px ${bold}`;
  ctx.fillStyle = colors.accent;
  ctx.fillText(price, L.textX, L.priceBaseline);

  ctx.font = `${L.titleSize}px ${semibold}`;
  ctx.fillStyle = colors.ink;
  lines.forEach((line, i) => ctx.fillText(line, L.textX, L.titleBaseline + i * L.titleLineHeight));

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new StoryArtworkError('canvas', 'Could not encode the image.'))),
        'image/png',
      );
    } catch {
      // A tainted canvas (photo without CORS) throws a SecurityError here.
      reject(new StoryArtworkError('photo', 'The browser blocked reading the photo.'));
    }
  });
}

/** Downloads the PNG via a temporary <a download>. Web only. */
export function saveBlobWeb(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type StoryShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

/** Shares the PNG file through the browser share sheet when it supports files. Web only. */
export async function shareBlobWeb(blob: Blob, filename: string, title: string): Promise<StoryShareOutcome> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) {
    return 'unsupported';
  }
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    return err instanceof Error && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

// ---------------------------------------------------------------- native

/** Writes a base64 PNG (from react-native-svg's toDataURL) to the cache and returns its file:// URI. */
export async function writeStoryPngNative(base64: string, filename: string): Promise<string> {
  // Loaded on demand so web (which never gets here) does not pull in the native module.
  const { File: FsFile, Paths } = await import('expo-file-system');
  const file = new FsFile(Paths.cache, filename);
  file.create({ overwrite: true });
  // toDataURL's base64 can carry line feeds, which strict base64 decoding rejects.
  file.write(base64.replace(/^data:image\/png;base64,/, '').replace(/\s/g, ''), { encoding: 'base64' });
  return file.uri;
}

/**
 * iOS only: the share sheet offers Save Image, Instagram and so on. React Native's
 * Share ignores `url` on Android, so there it reports false rather than sharing a path as text.
 * Resolves false when the sheet could not open.
 */
export async function shareFileNative(fileUri: string): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    await Share.share({ url: fileUri });
    return true;
  } catch {
    return false;
  }
}
