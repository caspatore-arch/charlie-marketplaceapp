/**
 * The automatic Community post every listing gets. It is a pointer row
 * (`community_posts.listing_id`, UNIQUE), not a copy: caption, price, photo,
 * status, likes, shares and comments are read from the listing at query time.
 * Upserting on the unique column makes a retried create, a relist, or a second
 * call from any other path idempotent: there is only ever one post per listing.
 */
import { communityPosts, type Listing } from '../db/schema';
import type { Db } from '../db/client';

/** The listing's own words for the compact Community post: its description, else its title. */
export function listingCaption(listing: Pick<Listing, 'title' | 'description'>): string {
  return listing.description?.trim() || listing.title;
}

/**
 * Creates (or refreshes) the listing's Community post. A relist gives the same
 * listing a new createdAt, so the post is moved to match it and any earlier
 * takedown of the pointer is cleared (the listing's own status decides whether
 * it is visible). The post never expires on its own: it follows the listing.
 */
export async function upsertListingPost(db: Db, listing: Listing): Promise<void> {
  const body = listingCaption(listing);
  await db
    .insert(communityPosts)
    .values({
      campusId: listing.campusId,
      authorId: listing.sellerId,
      kind: 'selling',
      body,
      createdAt: listing.createdAt,
      listingId: listing.id,
    })
    .onConflictDoUpdate({
      target: communityPosts.listingId,
      set: { body, createdAt: listing.createdAt, removedAt: null, removedById: null },
    });
}

/** Same, but never fails the caller: a listing must go live even if its Community post could not be written. */
export async function upsertListingPostQuietly(db: Db, listing: Listing): Promise<void> {
  try {
    await upsertListingPost(db, listing);
  } catch (err) {
    console.error('[community] could not create the listing post for', listing.id, err);
  }
}
