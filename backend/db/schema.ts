/**
 * Drizzle schema — PostgreSQL SQL, run locally on PGlite.
 * Mirrors docs/CONTRACT.md "Tables" exactly.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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

/* ----------------------------------------------------------------- tables */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const campuses = pgTable('campuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  emailDomains: text('email_domains').array().notNull(),
  timezone: text('timezone').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
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
    spotId: uuid('spot_id')
      .notNull()
      .references(() => meetupSpots.id),
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

/* ------------------------------------------------------------ row types */

export type Campus = typeof campuses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type MeetupSpot = typeof meetupSpots.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type ListingPhoto = typeof listingPhotos.$inferSelect;
export type AvailabilityWindow = typeof availabilityWindows.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type Report = typeof reports.$inferSelect;
