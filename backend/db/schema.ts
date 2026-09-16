/**
 * Drizzle schema — PostgreSQL SQL, run locally on PGlite.
 * Mirrors docs/CONTRACT.md "Tables" exactly.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

export const categoryEnum = pgEnum('category', [
  'clothing',
  'shoes',
  'jewelry',
  'accessories',
  'dorm',
  'books',
  'tech',
  'other',
]);

export const conditionEnum = pgEnum('condition', ['new', 'like_new', 'good', 'fair']);

export const listingStatusEnum = pgEnum('listing_status', [
  'active',
  'reserved',
  'sold',
  'expired',
  'removed',
]);

export const reservationStatusEnum = pgEnum('reservation_status', [
  'requested',
  'countered',
  'accepted',
  'declined',
  'cancelled',
  'expired',
  'completed',
]);

export const reportReasonEnum = pgEnum('report_reason', [
  'prohibited_item',
  'scam',
  'harassment',
  'no_show',
  'other',
]);

export const reportStatusEnum = pgEnum('report_status', ['open', 'reviewed']);

export const handoffMethodEnum = pgEnum('handoff_method', ['code', 'tap']);

/** Which kind of device registered a push token. */
export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android', 'web', 'unknown']);

/**
 * How a listing is sold. 'fixed' is the original (and default) behaviour —
 * every pre-auction row keeps working untouched. See docs/AUCTIONS.md §1.
 */
export const saleTypeEnum = pgEnum('sale_type', ['fixed', 'auction']);

/**
 * Lifecycle of one buyer payment (docs/AUCTIONS.md §3). Only the Stripe
 * webhook may move a row into a terminal state — never the client, never a
 * tRPC mutation.
 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'requires_payment',
  'paid',
  'failed',
  'refunded',
]);

/* ----------------------------------------------------------------- tables */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const campuses = pgTable('campuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  emailDomains: text('email_domains').array().notNull(),
  timezone: text('timezone').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  /**
   * Campus center for the "custom meetup address" radius check
   * (docs/AUCTIONS.md §2). Defaulted to the University of Arizona's
   * approximate coordinates so existing/seeded rows pick this up without a
   * seed.ts change — [FOUNDER TO CONFIRM], approximate.
   */
  centerLat: doublePrecision('center_lat').notNull().default(32.2319),
  centerLng: doublePrecision('center_lng').notNull().default(-110.9501),
  /** 2 miles. */
  meetupRadiusMeters: integer('meetup_radius_meters').notNull().default(3219),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // private — never included in public output shapes
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  campusId: uuid('campus_id')
    .notNull()
    .references(() => campuses.id),
  campusEmailVerifiedAt: ts('campus_email_verified_at'),
  bio: text('bio'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  /** Set by user.deleteAccount. Anonymized, not erased — the row stays. */
  deletedAt: ts('deleted_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    code: text('code').notNull(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
  },
  (t) => [index('email_codes_email_idx').on(t.email)],
);

export const meetupSpots = pgTable('meetup_spots', {
  id: uuid('id').primaryKey().defaultRandom(),
  campusId: uuid('campus_id')
    .notNull()
    .references(() => campuses.id),
  name: text('name').notNull(),
  /** Precise meeting description, e.g. "north entrance, by the bike racks". */
  description: text('description').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  hoursNote: text('hours_note'),
  isDemo: boolean('is_demo').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
});

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id),
    title: text('title').notNull(),
    description: text('description'),
    category: categoryEnum('category').notNull(),
    condition: conditionEnum('condition').notNull(),
    priceCents: integer('price_cents').notNull(),
    /** 'fixed' (default) or 'auction'. Auction columns below are null for 'fixed'. */
    saleType: saleTypeEnum('sale_type').notNull().default('fixed'),
    /** Auctions only: the seller's floor, >= 100 ($1). A single bid sells at this price. */
    startPriceCents: integer('start_price_cents'),
    /** Auctions only, optional: buy-it-now. Must be > startPriceCents. */
    buyoutPriceCents: integer('buyout_price_cents'),
    size: text('size'),
    brand: text('brand'),
    status: listingStatusEnum('status').notNull().default('active'),
    isSellToday: boolean('is_sell_today').notNull().default(false),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    soldAt: ts('sold_at'),
  },
  (t) => [
    index('listings_campus_status_idx').on(t.campusId, t.status),
    index('listings_sale_type_expires_idx').on(t.saleType, t.expiresAt),
    index('listings_seller_idx').on(t.sellerId),
  ],
);

export const listingPhotos = pgTable(
  'listing_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
  },
  (t) => [index('listing_photos_listing_idx').on(t.listingId)],
);

export const listingSpots = pgTable(
  'listing_spots',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    spotId: uuid('spot_id')
      .notNull()
      .references(() => meetupSpots.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.spotId] })],
);

export const availabilityWindows = pgTable(
  'availability_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
  },
  (t) => [index('availability_windows_listing_idx').on(t.listingId)],
);

/**
 * One row per bid. Bids are append-only: the current price is the highest
 * amount, so history stays auditable and settlement is a simple max().
 */
export const bids = pgTable(
  'bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    bidderId: uuid('bidder_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('bids_listing_amount_idx').on(t.listingId, t.amountCents.desc()),
    index('bids_bidder_idx').on(t.bidderId),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastMessageAt: ts('last_message_at'),
  },
  (t) => [uniqueIndex('conversations_listing_buyer_uq').on(t.listingId, t.buyerId)],
);

/** Per-participant read state for a conversation. One row per (conversation, user). */
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: ts('last_read_at'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_reads_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: reservationStatusEnum('status').notNull().default('requested'),
    /**
     * Exactly one of `spotId` or the custom-address trio below is set — a
     * meetup happens at a curated campus spot OR a party-proposed custom
     * address, never both, never neither. Enforced by a DB check
     * constraint (docs/AUCTIONS.md §2), not just app code.
     */
    spotId: uuid('spot_id').references(() => meetupSpots.id),
    /** Free-text address as geocoded, only ever shown to the two participants. */
    customAddress: text('custom_address'),
    customLat: doublePrecision('custom_lat'),
    customLng: doublePrecision('custom_lng'),
    /** Agreed (or currently proposed) meetup time. */
    startsAt: ts('starts_at').notNull(),
    /** Who made the proposal that is currently on the table. */
    proposedById: uuid('proposed_by_id')
      .notNull()
      .references(() => users.id),
    /** Price snapshot at the time of the request. */
    priceCents: integer('price_cents').notNull(),
    /** 4 digits, generated on accept; only the buyer may read it. */
    handoffCode: text('handoff_code'),
    buyerConfirmedAt: ts('buyer_confirmed_at'),
    sellerConfirmedAt: ts('seller_confirmed_at'),
    cancelledById: uuid('cancelled_by_id').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The DB-level guarantee that an item can only have ONE accepted hold.
    // Last line of defence behind the SELECT ... FOR UPDATE in reservation.accept.
    uniqueIndex('reservations_one_accepted_per_listing')
      .on(t.listingId)
      .where(sql`${t.status} = 'accepted'`),
    index('reservations_listing_idx').on(t.listingId),
    index('reservations_buyer_idx').on(t.buyerId),
    index('reservations_seller_idx').on(t.sellerId),
    // Exactly one of spotId or the (customAddress, customLat, customLng) trio.
    check(
      'reservations_spot_xor_custom',
      sql`(
        ${t.spotId} is not null
        and ${t.customAddress} is null and ${t.customLat} is null and ${t.customLng} is null
      ) or (
        ${t.spotId} is null
        and ${t.customAddress} is not null and ${t.customLat} is not null and ${t.customLng} is not null
      )`,
    ),
  ],
);

export const handoffConfirmations = pgTable('handoff_confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  confirmedAt: ts('confirmed_at').notNull().defaultNow(),
  method: handoffMethodEnum('method').notNull(),
});

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  targetListingId: uuid('target_listing_id').references(() => listings.id, {
    onDelete: 'cascade',
  }),
  reason: reportReasonEnum('reason').notNull(),
  details: text('details'),
  status: reportStatusEnum('status').notNull().default('open'),
  reviewedById: uuid('reviewed_by_id').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  moderatorNote: text('moderator_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const savedListings = pgTable(
  'saved_listings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);

/**
 * Read-through cache for `backend/geocode.ts` (Nominatim lookups). Keyed by
 * the normalized query text so repeat lookups of the same address don't hit
 * the third-party geocoder again — Nominatim's usage policy forbids heavy
 * traffic from one client.
 */
export const geocodeCache = pgTable('geocode_cache', {
  query: text('query').primaryKey(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  displayName: text('display_name').notNull(),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
});

/* -------------------------------------------------------- push notifications */

/**
 * One row per registered device. A user may have several (phone + tablet,
 * reinstalled the app, etc). `expoPushToken` is globally unique — re-registering
 * the same physical device for a different signed-in user moves the row to
 * that user rather than creating a duplicate (see backend/trpc/routes/notification.ts).
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token').notNull().unique(),
    platform: devicePlatformEnum('platform').notNull().default('unknown'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('device_tokens_user_idx').on(t.userId)],
);

/**
 * One row per user, created lazily on first write. A missing row means every
 * category defaults to on — see backend/trpc/routes/notification.ts.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  messages: boolean('messages').notNull().default(true),
  meetups: boolean('meetups').notNull().default(true),
  auctions: boolean('auctions').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/* ------------------------------------------------------- payments (§3) */

/**
 * One Stripe Connect **Express** account per seller. Mirrors the flags Stripe
 * reports so the app can say "payouts not set up" without a round trip; the
 * source of truth is always Stripe, refreshed by `payment.sellerStatus` and
 * the `account.updated` webhook.
 */
export const stripeAccounts = pgTable('stripe_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeAccountId: text('stripe_account_id').notNull().unique(),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  detailsSubmitted: boolean('details_submitted').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * One payment per reservation (unique), created when the winning buyer starts
 * checkout. `amountCents` is the whole charge; `feeCents` is the platform's
 * `application_fee_amount`. The remainder is transferred to the seller's
 * connected account — a **destination charge**, so the seller is paid out on
 * their normal Stripe schedule and the money is NOT held by this app.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    feeCents: integer('fee_cents').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    stripeChargeId: text('stripe_charge_id'),
    status: paymentStatusEnum('status').notNull().default('requires_payment'),
    /** Which mode produced this row: simulated | test | live. Never rewritten. */
    mode: text('mode').notNull().default('simulated'),
    paidAt: ts('paid_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('payments_buyer_idx').on(t.buyerId),
    index('payments_seller_idx').on(t.sellerId),
    uniqueIndex('payments_intent_uq').on(t.stripePaymentIntentId),
  ],
);

/**
 * Webhook idempotency. Stripe retries deliveries and can send the same event
 * twice; the event id is the primary key, so a second delivery of the same
 * event is a no-op insert conflict rather than a double state change.
 */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

/* ------------------------------------------------------------ row types */

export type Campus = typeof campuses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type MeetupSpot = typeof meetupSpots.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type ListingPhoto = typeof listingPhotos.$inferSelect;
export type AvailabilityWindow = typeof availabilityWindows.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationRead = typeof conversationReads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type GeocodeCacheRow = typeof geocodeCache.$inferSelect;
export type StripeAccount = typeof stripeAccounts.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentStatus = Payment['status'];
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
