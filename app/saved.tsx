/**
 * Saved screen: everything the buyer has hearted, soonest-expiring first, each
 * with a live "Expires in 5h" line. Sold, expired or removed items drop into a
 * collapsed "No longer available" group with a one-tap Remove instead of
 * silently vanishing. Unsaving is optimistic; there is no toast pattern in the
 * app, so there is no Undo (the heart on the listing re-saves it).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Heart } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListingCard } from '@/components/ListingCard';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import type { ListingCard as ListingCardType } from '@/types';

/** "Expires in 5h", "Expires in 40m", "Expires in under 1m". */
export function expiresInLabel(expiresAt: Date | string | null, now: number): string {
  if (!expiresAt) return 'Active';
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'Expires in under 1m';
  if (mins < 60) return `Expires in ${mins}m`;
  return `Expires in ${Math.floor(mins / 60)}h`;
}

function unavailableReason(l: ListingCardType, now: number): string {
  if (l.status === 'sold') return 'Sold';
  if (l.status === 'removed') return 'Removed by the seller';
  return 'Expired';
}

function isAvailable(l: ListingCardType, now: number): boolean {
  return (l.status === 'active' || l.status === 'reserved') && (!l.expiresAt || new Date(l.expiresAt).getTime() > now);
}

export default function SavedScreen() {
  const { user, status } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const savedQuery = trpc.listing.saved.useQuery(undefined, { enabled: !!user });
  const [now, setNow] = useState(() => Date.now());
  const [showGone, setShowGone] = useState(false);

  // Keep the countdowns honest while the screen stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const unsave = trpc.listing.toggleSave.useMutation({
    onMutate: async ({ id }) => {
      await utils.listing.saved.cancel();
      const previous = utils.listing.saved.getData();
      utils.listing.saved.setData(undefined, (old) => (old ?? []).filter((l) => l.id !== id));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) utils.listing.saved.setData(undefined, ctx.previous);
      Alert.alert('Could not remove', err.message);
    },
    onSettled: (_d, _e, vars) => {
      utils.listing.saved.invalidate();
      utils.listing.byId.invalidate({ id: vars.id });
    },
  });
  const remove = useCallback((id: string) => unsave.mutate({ id, saved: false }), [unsave]);

  const goToListing = useCallback((id: string) => router.push(`/listing/${id}`), [router]);

  const { available, gone } = useMemo(() => {
    const all = savedQuery.data ?? [];
    const avail = all
      .filter((l) => isAvailable(l, now))
      .sort(
        (a, b) =>
          (a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity) -
          (b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity),
      );
    return { available: avail, gone: all.filter((l) => !isAvailable(l, now)) };
  }, [savedQuery.data, now]);

  const title = <Stack.Screen options={{ title: 'Saved' }} />;

  if (status === 'loading' || (user && savedQuery.isPending)) {
    return (
      <Screen>
        {title}
        <View style={styles.gridRow}>
          <Skeleton height={220} style={styles.cell} />
          <Skeleton height={220} style={styles.cell} />
        </View>
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen>
        {title}
        <EmptyState
          title="Sign in to see your saved items"
          body="Saved items are kept on your account."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
      </Screen>
    );
  }

  if (savedQuery.isError) {
    return (
      <Screen>
        {title}
        <ErrorState message={savedQuery.error.message} onRetry={() => savedQuery.refetch()} />
      </Screen>
    );
  }

  if (available.length === 0 && gone.length === 0) {
    return (
      <Screen>
        {title}
        <EmptyState
          icon={<Heart size={40} color={colors.inkFaint} />}
          title="Nothing saved yet"
          body="Tap the heart on anything you might want. Saved items stay here. When a listing's 24 hours end it moves to the Archive."
          actionLabel="Browse"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const footer =
    gone.length > 0 ? (
      <View style={styles.goneWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showGone }}
          accessibilityLabel={`No longer available, ${gone.length} ${gone.length === 1 ? 'item' : 'items'}`}
          onPress={() => setShowGone((v) => !v)}
          style={({ pressed }) => [styles.goneHeader, pressed && styles.pressed]}
        >
          <Text variant="heading" style={styles.goneTitle}>
            No longer available ({gone.length})
          </Text>
          {showGone ? (
            <ChevronUp size={20} color={colors.inkFaint} />
          ) : (
            <ChevronDown size={20} color={colors.inkFaint} />
          )}
        </Pressable>
        {showGone
          ? gone.map((l) => (
              <View key={l.id} style={styles.goneRow}>
                <View style={styles.goneText}>
                  <Text variant="label" numberOfLines={1}>
                    {l.title}
                  </Text>
                  <Text variant="caption" color="inkMuted">
                    {unavailableReason(l, now)}
                  </Text>
                </View>
                <Button
                  title="Remove"
                  variant="secondary"
                  onPress={() => remove(l.id)}
                  accessibilityLabel={`Remove ${l.title} from saved`}
                />
              </View>
            ))
          : null}
      </View>
    ) : null;

  return (
    <Screen>
      {title}
      <FlatList
        data={available}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListFooterComponent={footer}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <ListingCard listing={item} onPress={() => goToListing(item.id)} />
            <View style={styles.metaRow}>
              <Text variant="caption" weight="600" color="accent" style={styles.expires}>
                {expiresInLabel(item.expiresAt, now)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title} from saved`}
                onPress={() => remove(item.id)}
                hitSlop={8}
                style={({ pressed }) => [styles.heartBtn, pressed && styles.pressed]}
              >
                <Heart size={20} color={colors.accent} fill={colors.accent} />
              </Pressable>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gridRow: { gap: space.md },
  gridContent: { gap: space.md, paddingBottom: space.xxl },
  // maxWidth keeps a lone last-row cell at half width.
  cell: { flex: 1, maxWidth: '50%' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expires: { flexShrink: 1 },
  heartBtn: {
    width: minTouchHeight,
    height: minTouchHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  goneWrap: { marginTop: space.lg, gap: space.sm },
  goneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchHeight,
  },
  goneTitle: { flex: 1 },
  goneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  goneText: { flex: 1, gap: 2 },
});
