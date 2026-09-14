/**
 * Shared TS types, inferred from the backend router so the client always
 * matches the server's actual output shapes (docs/CONTRACT.md is the prose
 * version of this). Screen agents should import types from here rather than
 * re-declaring shapes by hand.
 */
import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '@/backend/trpc/app-router';

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

// ---- listing ----
export type ListingCard = RouterOutputs['listing']['feed']['items'][number];
export type ListingDetail = RouterOutputs['listing']['byId'];

// ---- reservation ----
export type Reservation = RouterOutputs['reservation']['request'];
export type ReservationDetail = RouterOutputs['reservation']['byId'];

// ---- conversation / messages ----
export type ConversationSummary = RouterOutputs['conversation']['list'][number];
export type Conversation = RouterOutputs['conversation']['open'];
export type Message = RouterOutputs['conversation']['messages']['items'][number];

// ---- user ----
export type AuthUser = RouterOutputs['auth']['me'];
export type PublicProfile = RouterOutputs['user']['byId'];

// ---- campus ----
export type Campus = RouterOutputs['campus']['list'][number];
export type MeetupSpot = RouterOutputs['campus']['spots'][number];

// ---- payment ----
export type FeeQuote = RouterOutputs['payment']['quote'];

// ---- enums (mirrored from docs/CONTRACT.md; keep in sync with backend/db/schema.ts) ----
export type ListingStatus = 'active' | 'reserved' | 'sold' | 'expired' | 'removed';
export type ReservationStatus =
  | 'requested'
  | 'countered'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'completed';
export type ReportReason = 'prohibited_item' | 'scam' | 'harassment' | 'no_show' | 'other';
