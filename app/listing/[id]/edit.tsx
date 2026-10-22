/**
 * Edit-listing modal route. Loads `listing.byId`, guards that the viewer is
 * the seller, pre-fills the shared ListingForm (Save, Cancel, then a text-style
 * Remove below them), and for an expired/removed listing shows the relist
 * panel as the primary action instead of the form.
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { confirmAction } from '@/utils/confirm';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListingForm, type ListingFormInitialValues, type ListingFormSubmitValues } from '@/components/sell/ListingForm';
import { RelistPanel } from '@/components/sell/RelistPanel';
import { GuardedCloseButton } from '@/components/sell/GuardedCloseButton';
import { useAuth } from '@/hooks/useAuth';
import { nextSlotBoundary, SLOT_MS } from '@/components/booking/time';
import { trpc } from '@/lib/trpc';
import { minTouchHeight, space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';
import type { ListingDetail } from '@/types';

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { user } = useAuth();

  const listingQuery = trpc.listing.byId.useQuery({ id: id! }, { enabled: !!id });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const isSellerView = listingQuery.data?.viewerRole === 'seller';
  const meetupsQuery = trpc.reservation.forListing.useQuery({ listingId: id! }, { enabled: !!id && isSellerView });
  const openMeetups = (meetupsQuery.data ?? []).filter(
    (m) => m.status === 'requested' || m.status === 'countered' || m.status === 'accepted',
  );

  const invalidateAndGo = async (listing: ListingDetail) => {
    await Promise.all([
      utils.listing.feed.invalidate(),
      utils.listing.mine.invalidate(),
      utils.listing.byId.invalidate({ id: listing.id }),
    ]);
    router.replace(`/listing/${listing.id}`);
  };

  const updateMutation = trpc.listing.update.useMutation({
    onSuccess: (listing) => invalidateAndGo(listing),
    onError: (err) => setSubmitError(err.message),
  });

  const relistMutation = trpc.listing.relist.useMutation({
    onSuccess: (listing) => invalidateAndGo(listing),
    onError: (err) => Alert.alert('Could not relist', err.message),
  });

  const removeMutation = trpc.listing.remove.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.listing.feed.invalidate(),
        utils.listing.mine.invalidate(),
        id ? utils.listing.byId.invalidate({ id }) : Promise.resolve(),
      ]);
      router.replace('/profile');
    },
    onError: (err) => Alert.alert('Could not remove listing', err.message),
  });

  function handleSubmit(values: ListingFormSubmitValues) {
    if (!id) return;
    setSubmitError(null);
    updateMutation.mutate({ id, ...values });
  }

  function handleRemove() {
    if (!id) return;
    const meetupNote =
      openMeetups.length > 0
        ? ` You have ${openMeetups.length} booked meetup${openMeetups.length === 1 ? '' : 's'} on this item. Cancel ${openMeetups.length === 1 ? 'it' : 'them'} first or tell the buyer, because removing the listing does not cancel ${openMeetups.length === 1 ? 'it' : 'them'}.`
        : '';
    confirmAction(
      'Remove this listing?',
      `Buyers will no longer be able to see or book it.${meetupNote}`,
      'Remove',
      () => removeMutation.mutate({ id }),
    );
  }

  function handleClose() {
    if (dirty) {
      confirmAction('Discard your changes?', 'Your edits to this listing will be lost.', 'Discard', () => router.back(), {
        cancelLabel: 'Keep editing',
      });
    } else {
      router.back();
    }
  }

  if (!id || listingQuery.isPending) {
    return (
      <Screen>
        <View style={styles.loading}>
          <Skeleton height={200} />
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="40%" />
        </View>
      </Screen>
    );
  }

  if (listingQuery.isError) {
    return (
      <Screen>
        <ErrorState message={listingQuery.error.message} onRetry={() => listingQuery.refetch()} />
      </Screen>
    );
  }

  const listing = listingQuery.data;

  if (listing.viewerRole !== 'seller') {
    return (
      <Screen>
        <EmptyState
          title="You can't edit this"
          body="This listing belongs to someone else."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  // Windows already in the past can't be re-saved (the server requires future
  // windows), so trim them to start no earlier than the next quarter hour.
  const earliest = nextSlotBoundary().getTime();
  const editableWindows = listing.availabilityWindows
    .map((w) => ({
      key: w.id,
      startsAt: new Date(Math.max(new Date(w.startsAt).getTime(), earliest)).toISOString(),
      endsAt: new Date(w.endsAt).toISOString(),
    }))
    .filter((w) => new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime() >= SLOT_MS);

  const initialValues: Partial<ListingFormInitialValues> = {
    photos: listing.photos.map((p) => ({ key: p.id, url: p.url, status: 'done' as const })),
    title: listing.title,
    category: listing.category,
    condition: listing.condition,
    priceCents: listing.priceCents,
    size: listing.size ?? '',
    brand: listing.brand ?? '',
    description: listing.description ?? '',
    spotIds: listing.spots.map((s) => s.id),
    windows: editableWindows,
  };

  const canRelist = listing.status === 'expired' || listing.status === 'removed';
  const trimmedCount = listing.availabilityWindows.filter(
    (w) => new Date(w.startsAt).getTime() < earliest,
  ).length;
  const trimmedNotice =
    trimmedCount > 0 ? 'Times that already passed were shortened or removed. Add new ones if you need them.' : undefined;
  const bookedMeetup = openMeetups[0];
  const bookedNotice = bookedMeetup
    ? `A meetup is already booked at ${formatPrice(bookedMeetup.priceCents)}. Changes to price, spots or times won't affect it.`
    : undefined;

  const removeAction =
    listing.status === 'removed' ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove listing"
        onPress={handleRemove}
        disabled={removeMutation.isPending}
        style={styles.removeTarget}
      >
        <Text variant="label" color="danger" style={styles.removeText}>
          {removeMutation.isPending ? 'Removing…' : 'Remove listing'}
        </Text>
      </Pressable>
    );

  if (canRelist) {
    return (
      <Screen scroll contentContainerStyle={styles.relistContent}>
        <Stack.Screen options={{ title: 'Edit listing', headerLeft: () => <GuardedCloseButton onPress={handleClose} /> }} />
        <RelistPanel
          status={listing.status}
          priceCents={listing.priceCents}
          timeZone={user?.campus?.timezone}
          loading={relistMutation.isPending}
          onRelist={({ priceCents, windows }) =>
            relistMutation.mutate({ id: listing.id, isSellToday: true, priceCents, windows })
          }
        />
        <View style={styles.removeWrap}>{removeAction}</View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Edit listing', headerLeft: () => <GuardedCloseButton onPress={handleClose} /> }} />
      <ListingForm
        key={listing.id}
        initialValues={initialValues}
        submitLabel="Save changes"
        listingId={listing.id}
        submitting={updateMutation.isPending}
        submitError={submitError}
        until={listing.expiresAt ? new Date(listing.expiresAt) : undefined}
        bookedNotice={bookedNotice}
        windowsNotice={trimmedNotice}
        onSubmit={handleSubmit}
        onDirtyChange={setDirty}
        afterSubmit={
          <View style={styles.afterSave}>
            <Button title="Cancel" variant="ghost" onPress={handleClose} />
            {removeAction}
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.md, marginTop: space.xl },
  relistContent: { gap: space.xl, paddingBottom: space.huge },
  afterSave: { alignItems: 'center', alignSelf: 'stretch', gap: space.xs },
  removeWrap: { alignItems: 'center' },
  removeTarget: { minHeight: minTouchHeight, justifyContent: 'center', paddingHorizontal: space.md },
  removeText: { textDecorationLine: 'underline' },
});
