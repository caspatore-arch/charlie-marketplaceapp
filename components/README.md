# Components

## UI primitives (`components/ui/`)

- `Screen` — `<Screen scroll><YourContent /></Screen>` — safe-area + themed background wrapper.
- `Text` — `<Text variant="title">Dibbs</Text>` — themed text with the DESIGN.md type scale.
- `Button` — `<Button title="Send request" onPress={submit} loading={isPending} />`
- `Chip` — `<Chip label="Clothing" selected={cat === 'clothing'} onPress={() => setCat('clothing')} />`
- `Badge` — `<Badge kind="demo" />` / `<Badge kind="verified" />` / `<Badge kind="status" label="Reserved" tone="warning" />`
- `Card` — `<Card onPress={openDetail}><Text>...</Text></Card>` — surface with the app's one soft shadow.
- `Input` / `TextArea` — `<Input label="Email" value={v} onChangeText={setV} error={err} />`
- `Sheet` — `<Sheet visible={open} onClose={close} title="Pick a time">{...}</Sheet>` — bottom sheet via Modal.
- `EmptyState` — `<EmptyState icon={<Search />} title="No listings yet" actionLabel="Refresh" onAction={refetch} />`
- `Skeleton` — `<Skeleton width={120} height={16} />` — loading placeholder, respects Reduce Motion.
- `ErrorState` — `<ErrorState message={error.message} onRetry={refetch} />`
- `Avatar` — `<Avatar uri={user.avatarUrl} name={user.displayName} size={32} />`
- `PriceText` — `<PriceText cents={listing.priceCents} />` — bold, tabular-nums price.
- `Divider` — `<Divider />`

Import from the barrel: `import { Button, Text, Card } from '@/components/ui';`

## Feature components (`components/`)

- `ListingCard` — `<ListingCard listing={item} onPress={() => router.push(\`/listing/${item.id}\`)} />` — 2-col grid card (photo, price, title, condition/size, seller, Today/Demo badges).
- `PhotoGallery` — `<PhotoGallery photos={listingDetail.photos} />` — horizontal paging gallery with dots.
- `SellerRow` — `<SellerRow seller={listingDetail.seller} onPress={() => router.push(\`/user/${seller.id}\`)} />`
- `SpotPicker` — `<SpotPicker spots={spots} selectedId={spotId} onSelect={setSpotId} />` (pass `selectedIds`/`onToggle` for multi-select in Sell).
- `TimeSlotPicker` — `<TimeSlotPicker windows={windows} selectedIso={startsAt} onSelect={setStartsAt} timeZone={campus.timezone} />` — day tabs + 30-min slot chips.
- `MeetupCard` — `<MeetupCard photoUrl={...} title={...} priceCents={...} spotName={...} spotDescription={...} startsAt={...} status={...} />` — the signature reservation summary card.
- `ReservationStatusPill` — `<ReservationStatusPill status={reservation.status} />`
- `MessageBubble` — `<MessageBubble body={msg.body} createdAt={msg.createdAt} isOwn={msg.senderId === user.id} />`
- `FeeBreakdown` — `<FeeBreakdown quote={feeQuoteQuery.data} />` — always labeled "Simulated — no money moves".
- `DemoBadge` — `<DemoBadge visible={listing.seller.isDemo} />` — thin wrapper around `<Badge kind="demo" />` that renders nothing when not visible.

## Providers / infra

- `AuthProvider` (`components/AuthProvider.tsx`) — wraps the app (see `app/_layout.tsx`), exposes state via `useAuth()` / `useRequireAuth()` from `hooks/useAuth.ts`.
