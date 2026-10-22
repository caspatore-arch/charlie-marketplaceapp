/**
 * "Fill in from photos": looks at a seller's uploaded photos and drafts the
 * listing (title, category, condition, brand, description, price range).
 *
 * Simulated by default, like payments and email: without LISTING_AI_MODE=live
 * AND an ANTHROPIC_API_KEY it returns a fixed demo draft and makes no network
 * call, so tests and demos never spend money. Tests (NODE_ENV=test) always
 * simulate.
 *
 * Live mode sends the photo bytes (read back from upload storage, never a
 * client-supplied URL) to Claude and asks for JSON matching DraftSchema.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { env } from '../env';
import { storage } from '../storage';

const CATEGORIES = ['clothing', 'shoes', 'jewelry', 'accessories', 'dorm', 'books', 'tech', 'other'] as const;
const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;

const DraftSchema = z.object({
  title: z.string(),
  category: z.enum(CATEGORIES),
  condition: z.enum(CONDITIONS),
  brand: z.string(),
  description: z.string(),
  priceLowDollars: z.number(),
  priceHighDollars: z.number(),
});

export interface ListingDraft {
  title: string;
  category: (typeof CATEGORIES)[number];
  condition: (typeof CONDITIONS)[number];
  /** Empty when no brand is visible. */
  brand: string;
  description: string;
  /** The model's guess at a fair used price, in cents. An estimate, not sales data. */
  priceLowCents: number;
  priceHighCents: number;
  /** True when this came from the offline demo draft, not a real model. */
  simulated: boolean;
}

export class ListingDraftError extends Error {}

export function resolveListingAiMode(): 'live' | 'simulated' {
  if (process.env.NODE_ENV === 'test') return 'simulated';
  return env.listingAiModeRaw === 'live' && env.anthropicApiKey ? 'live' : 'simulated';
}

/** Claude reads these; HEIC and SVG are skipped. */
const VISION_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type VisionType = (typeof VISION_TYPES)[number];
/** The API's per-image ceiling. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = `You write listings for Dibbs, a secondhand marketplace where college students sell to other students on the same campus.

From the photos, draft one listing:
- title: what the item is, with brand and key detail, under 60 characters. No hype words.
- category: the closest fit. "dorm" covers furniture, decor, kitchen and storage.
- condition: judge only from what the photos show. "new" only if tags or packaging are visible. When unsure, pick the lower condition.
- brand: only if a logo or label is visible, otherwise an empty string.
- description: 2 to 4 short, plain sentences a student would write. Mention visible wear or flaws. Do not invent specs, sizes or history you cannot see.
- priceLowDollars / priceHighDollars: a realistic range a student buyer would pay for this used item, in whole dollars. Used items on campus usually sell for 25-50% of retail. Keep the range tight.

If the photos show different items, describe the main one.`;

function simulatedDraft(): ListingDraft {
  return {
    title: 'Desk lamp with adjustable arm',
    category: 'dorm',
    condition: 'good',
    brand: '',
    description:
      'Demo draft: AI autofill is off on this server, so this text is a placeholder. Replace it with details about your item.',
    priceLowCents: 1000,
    priceHighCents: 1800,
    simulated: true,
  };
}

/** `/api/uploads/<name>` or a public bucket URL → the stored object name. */
function uploadNameFromUrl(url: string): string {
  const clean = url.split('?')[0] ?? '';
  return clean.slice(clean.lastIndexOf('/') + 1);
}

async function loadImages(photoUrls: string[]): Promise<{ data: string; mediaType: VisionType }[]> {
  const images: { data: string; mediaType: VisionType }[] = [];
  for (const url of photoUrls) {
    const file = await storage.get(uploadNameFromUrl(url));
    if (!file) continue;
    if (!(VISION_TYPES as readonly string[]).includes(file.contentType)) continue;
    if (file.bytes.byteLength > MAX_IMAGE_BYTES) continue;
    images.push({ data: file.bytes.toString('base64'), mediaType: file.contentType as VisionType });
  }
  return images;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 45_000, maxRetries: 1 });
  return client;
}

function toCents(dollars: number): number {
  return Math.max(100, Math.round(dollars) * 100);
}

export async function draftListingFromPhotos(photoUrls: string[]): Promise<ListingDraft> {
  if (resolveListingAiMode() === 'simulated') return simulatedDraft();

  const images = await loadImages(photoUrls);
  if (images.length === 0) {
    throw new ListingDraftError('Autofill works with JPEG, PNG or WebP photos under 5 MB. Fill in the details yourself.');
  }

  let response;
  try {
    response = await getClient().messages.parse({
      model: env.listingAiModel,
      max_tokens: 4000,
      // A short extraction task: low effort keeps it fast and cheap.
      output_config: { effort: 'low', format: zodOutputFormat(DraftSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
            })),
            { type: 'text' as const, text: 'Draft the listing for this item.' },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new ListingDraftError('Autofill is busy right now. Try again in a minute, or fill in the details yourself.');
    }
    console.error('[listing-ai] request failed', err instanceof Anthropic.APIError ? err.status : '', err);
    throw new ListingDraftError('Autofill could not read your photos. Fill in the details yourself.');
  }

  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) {
    throw new ListingDraftError('Autofill could not describe this item. Fill in the details yourself.');
  }

  const low = toCents(Math.min(out.priceLowDollars, out.priceHighDollars));
  const high = toCents(Math.max(out.priceLowDollars, out.priceHighDollars));
  return {
    title: out.title.trim().slice(0, 80),
    category: out.category,
    condition: out.condition,
    brand: out.brand.trim().slice(0, 60),
    description: out.description.trim().slice(0, 1000),
    priceLowCents: Math.min(low, 5_000_00),
    priceHighCents: Math.min(high, 5_000_00),
    simulated: false,
  };
}
