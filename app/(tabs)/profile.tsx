/**
 * Profile tab. Signed-out: sign-in CTA. Signed-in: identity, active listings
 * grid, saved listings, a link to Settings (account details, blocked users,
 * sign out, close account), and (dev builds only) a "Switch test user"
 * panel for the three seeded identities in CONTRACT.md.
 */
import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Divider } from '@/components/ui/Divider';
import { InboxLinkRow } from '@/components/inbox/InboxLinkRow';
import { ListingCard } from '@/components/ListingCard';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { space } from '@/constants/theme';
import type { ListingCard as ListingCardType } from '@/types';

const DEV_TEST_USERS = [
  { id: '00000000-0000-4000-8000-000000000001', label: 'Maya Test' },
  { id: '00000000-0000-4000-8000-000000000002', label: 'Jordan Test' },
  { id: '00000000-0000-4000-8000-000000000003', label: 'Sam Test' },
];

export default function ProfileScreen() {
  const { status, user, devSignIn } = useAuth();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <Screen>
        <View style={styles.loadingWrap}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={140} height={20} />
          <Skeleton width={200} height={14} />
        </View>
      </Screen>
    );
  }

  if (status === 'signedOut' || !user) {
    return (
      <Screen>
        <EmptyState
          title="Sign in to see your profile"
          body="Track your listings, saved items, and meetups once you're signed in."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
        {process.env.EXPO_PUBLIC_DEV_LOGIN === '1' ? (
          <DevSwitchUser onSelect={devSignIn} />
        ) : null}
      </Screen>
    );
  }

  return <SignedInProfile userId={user.id} displayName={user.displayName} onDevSignIn={devSignIn} />;
}

function SignedInProfile({
  userId,
  displayName,
  onDevSignIn,
}: {
  userId: string;
  displayName: string;
  onDevSignIn: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const meQuery = trpc.auth.me.useQuery();
  const mineQuery = trpc.listing.mine.useQuery();
  const savedQuery = trpc.listing.saved.useQuery();
  const isModeratorQuery = trpc.moderation.isModerator.useQuery();

  const goToListing = useCallback((id: string) => router.push(`/listing/${id}`), [router]);

  const activeListings = (mineQuery.data ?? []).filter((l: ListingCardType) => l.status === 'active');

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Avatar uri={meQuery.data?.avatarUrl} name={displayName} size={72} />
        <Text variant="title" style={styles.name}>
          {displayName}
        </Text>
        {meQuery.data?.campus?.name ? (
          <Text variant="body" color="inkMuted">
            {meQuery.data.campus.name}
          </Text>
        ) : null}
        {meQuery.data?.campusEmailVerifiedAt ? <Badge kind="verified" /> : null}
      </View>

      <View style={styles.inboxLink}>
        <InboxLinkRow />
      </View>

      <Section title="My listings">
        {mineQuery.isPending ? (
          <GridSkeleton />
        ) : mineQuery.isError ? (
          <ErrorState message={mineQuery.error.message} onRetry={() => mineQuery.refetch()} />
        ) : activeListings.length === 0 ? (
          <EmptyState title="No active listings" body="Items you list will show up here." />
        ) : (
          <ListingGrid listings={activeListings} onPress={goToListing} showSeller={false} />
        )}
      </Section>

      <Section title="Saved">
        {savedQuery.isPending ? (
          <GridSkeleton />
        ) : savedQuery.isError ? (
          <ErrorState message={savedQuery.error.message} onRetry={() => savedQuery.refetch()} />
        ) : (savedQuery.data ?? []).length === 0 ? (
          <EmptyState title="Nothing saved yet" body="Tap the save icon on a listing to keep it here." />
        ) : (
          <ListingGrid listings={savedQuery.data ?? []} onPress={goToListing} />
        )}
      </Section>

      {isModeratorQuery.data ? (
        <Section title="Moderation">
          <Button
            title="Moderation"
            variant="secondary"
            onPress={() => router.push('/moderation')}
            accessibilityLabel="Open moderation"
          />
        </Section>
      ) : null}

      <Button
        title="Settings"
        variant="secondary"
        onPress={() => router.push('/settings')}
        style={styles.settingsButton}
        accessibilityLabel="Open settings"
      />

      {process.env.EXPO_PUBLIC_DEV_LOGIN === '1' ? (
        <DevSwitchUser onSelect={onDevSignIn} currentUserId={userId} />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="heading" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
      <Divider style={styles.sectionDivider} />
    </View>
  );
}

function ListingGrid({
  listings,
  onPress,
  showSeller = true,
}: {
  listings: ListingCardType[];
  onPress: (id: string) => void;
  /** False for "My listings" — every row would read the viewer's own name.
   *  Saved items keep it: there the seller is the thing you want to know. */
  showSeller?: boolean;
}) {
  return (
    <FlatList
      data={listings}
      keyExtractor={(item) => item.id}
      numColumns={2}
      scrollEnabled={false}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={styles.gridContent}
      renderItem={({ item }) => (
        <View style={styles.gridCell}>
          <ListingCard listing={item} onPress={() => onPress(item.id)} showSeller={showSeller} />
        </View>
      )}
    />
  );
}

function GridSkeleton() {
  return (
    <View style={styles.gridRow}>
      <Skeleton height={180} style={styles.gridCell} />
      <Skeleton height={180} style={styles.gridCell} />
    </View>
  );
}

function DevSwitchUser({
  onSelect,
  currentUserId,
}: {
  onSelect: (id: string) => Promise<void>;
  currentUserId?: string;
}) {
  return (
    <View style={styles.devWrap}>
      <Text variant="label" color="inkMuted" style={styles.devTitle}>
        Switch test user (dev only)
      </Text>
      <View style={styles.devButtons}>
        {DEV_TEST_USERS.map((u) => (
          <Button
            key={u.id}
            title={u.id === currentUserId ? `${u.label} (current)` : u.label}
            variant={u.id === currentUserId ? 'primary' : 'secondary'}
            onPress={() => onSelect(u.id)}
            disabled={u.id === currentUserId}
            style={styles.devButton}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { alignItems: 'center', gap: space.sm, paddingTop: space.huge },
  header: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  name: { marginTop: space.sm },
  inboxLink: { marginBottom: space.sm },
  section: { marginTop: space.md },
  sectionTitle: { marginBottom: space.md },
  sectionDivider: { marginTop: space.xl },
  gridRow: { gap: space.md },
  gridContent: { gap: space.md },
  // maxWidth pins a lone cell to half the row. With numColumns={2} a flex:1
  // cell stretches to the full width whenever a row is short — one search
  // result rendered as a single giant card.
  gridCell: { flex: 1, maxWidth: '50%' },
  settingsButton: { marginTop: space.lg },
  devWrap: { marginTop: space.xxl, marginBottom: space.xxl },
  devTitle: { marginBottom: space.sm },
  devButtons: { gap: space.sm },
  devButton: { width: '100%' },
});
