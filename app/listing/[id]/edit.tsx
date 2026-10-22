/**
 * Edit-listing modal route. Loads `listing.byId`, guards that the viewer is
 * the seller, pre-fills the shared ListingForm, and adds a "More" section for
 * relisting an expired/removed item and removing the listing entirely.
 */
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { confirmAction } from '@/utils/confirm';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListingForm, type ListingFormInitialValues, type ListingFormSubmitValues } from '@/components/sell/ListingForm';
import { WindowEditor, type WindowItem } from '@/components/sell/WindowEditor';
import { useAuth } from '@/hooks/useAuth';
import { DAY_MS, nextSlotBoundary, SLOT_MS } from '@/components/booking/time';
import { trpc } from '@/lib/trpc';
import { space } from '@/constants/theme';
import type { ListingDetail } from '@/types';

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { user } = useAuth();

  const listingQuery = trpc.listing.byId.useQuery({ id: id! }, { enabled: !!id });

  const [submitError, setSubmitError] = useState<string | null>(null);

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
    confirmAction('Remove this listing?', 'Buyers will no longer be able to see or request it.', 'Remove', () =>
      removeMutation.mutate({ id }),
    );
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

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Edit listing' }} />
      <ListingForm
        key={listing.id}
        initialValues={initialValues}
        submitLabel="Save changes"
        listingId={listing.id}
        submitting={updateMutation.isPending}
        submitError={submitError}
        until={listing.expiresAt ? new Date(listing.expiresAt) : undefined}
        onSubmit={handleSubmit}
        footer={
          <View>
            <Divider style={styles.divider} />
            <Text variant="heading" style={styles.moreTitle}>
              More
            </Text>

            {canRelist ? (
              <View style={styles.moreSection}>
                <Text variant="body" color="inkMuted" style={styles.moreCopy}>
                  This listing is {listing.status}. Relist it to make it visible again.
                </Text>
                <RelistControl
                  onRelist={(windows) => relistMutation.mutate({ id: listing.id, isSellToday: true, windows })}
                  loading={relistMutation.isPending}
                  timeZone={user?.campus?.timezone}
                />
              </View>
            ) : null}

            <View style={styles.moreSection}>
              <Button
                title="Remove listing"
                variant="danger"
                onPress={handleRemove}
                loading={removeMutation.isPending}
              />
            </View>
          </View>
        }
      />
    </Screen>
  );
}

function RelistControl({
  onRelist,
  loading,
  timeZone,
}: {
  onRelist: (windows: { startsAt: string; endsAt: string }[]) => void;
  loading: boolean;
  timeZone?: string;
}) {
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [until] = useState(() => new Date(Date.now() + DAY_MS));
  return (
    <View style={styles.relistWrap}>
      <Text variant="caption" color="inkMuted">
        Relisting makes it live for another 24 hours at the same asking price. Pick the times buyers can book.
      </Text>
      <WindowEditor windows={windows} onChange={setWindows} until={until} timeZone={timeZone} />
      <Button
        title="Relist"
        onPress={() => onRelist(windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })))}
        loading={loading}
        disabled={windows.length === 0}
        style={styles.relistButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.md, marginTop: space.xl },
  divider: { marginBottom: space.lg },
  moreTitle: { marginBottom: space.md },
  moreCopy: { marginBottom: space.md },
  moreSection: { marginBottom: space.lg },
  relistWrap: { gap: space.md },
  relistButton: {},
});
