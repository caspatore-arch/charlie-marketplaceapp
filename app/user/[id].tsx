/**
 * Someone's profile: picture, bio, follow button and counts, trust block, then
 * Listings / Posts tabs. Report and Block live at the bottom. Conversations
 * are never shown here, for anyone: they are private between two people.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProfileSkeleton } from '@/components/ui/ProfileSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { TrustBlock } from '@/components/TrustSignals';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileContent } from '@/components/profile/ProfileContent';
import { FollowButton } from '@/components/profile/FollowButton';
import { FollowListPanel, type FollowDirection } from '@/components/profile/FollowListPanel';
import { trpc } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { space } from '@/constants/theme';
import { confirmAction } from '@/utils/confirm';

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();

  const profileQuery = trpc.user.byId.useQuery({ id }, { enabled: !!id });
  const trustQuery = trpc.user.trustSummary.useQuery({ id }, { enabled: !!id });
  const [openList, setOpenList] = useState<FollowDirection | null>(null);

  const utils = trpc.useUtils();
  const blockMutation = trpc.user.block.useMutation({
    onSuccess: () => {
      void utils.user.byId.invalidate({ id });
      void utils.user.followList.invalidate();
    },
  });
  const reportMutation = trpc.user.report.useMutation();

  const confirmBlock = useCallback(() => {
    if (!requireAuth(`/user/${id}`)) return;
    confirmAction(
      'Block this user?',
      'They will no longer be able to message or request meetups with you.',
      'Block',
      () => blockMutation.mutate({ userId: id }),
    );
  }, [requireAuth, id, blockMutation]);

  const confirmReport = useCallback(() => {
    if (!requireAuth(`/user/${id}`)) return;
    confirmAction(
      'Report this user?',
      "We'll review this account for platform violations.",
      'Report',
      () => reportMutation.mutate({ targetUserId: id, reason: 'other' }),
    );
  }, [requireAuth, id, reportMutation]);

  if (profileQuery.isPending) {
    return (
      <Screen>
        <ProfileSkeleton />
      </Screen>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <Screen>
        <ErrorState message={profileQuery.error?.message ?? 'This profile could not be found.'} onRetry={() => profileQuery.refetch()} />
      </Screen>
    );
  }

  const profile = profileQuery.data;
  const isSelf = user?.id === profile.id;

  const firstName = profile.displayName.split(' ')[0] || profile.displayName;

  return (
    <Screen scroll>
      <ProfileHeader
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        campusName={profile.campus?.name}
        bio={profile.bio}
        campusEmailVerified={profile.campusEmailVerified}
        isDemo={profile.isDemo}
        instagramHandle={profile.instagramHandle}
        contactPhone={profile.contactPhone}
        followerCount={profile.followerCount}
        followingCount={profile.followingCount}
        openList={openList}
        onToggleList={(d) => setOpenList((cur) => (cur === d ? null : d))}
        action={
          !isSelf && !profile.isClosed ? (
            <FollowButton userId={profile.id} viewerFollows={profile.viewerFollows} displayName={profile.displayName} />
          ) : null
        }
      />

      {openList ? <FollowListPanel userId={profile.id} direction={openList} isSelf={isSelf} /> : null}

      {trustQuery.isPending ? (
        <Skeleton height={140} radius={20} style={styles.trustBlock} />
      ) : trustQuery.data ? (
        <TrustBlock summary={trustQuery.data} style={styles.trustBlock} />
      ) : null}

      <ProfileContent userId={profile.id} isSelf={isSelf} firstName={firstName} />

      {!isSelf ? (
        <View style={styles.actions}>
          <Button title="Report" variant="secondary" onPress={confirmReport} style={styles.actionBtn} />
          <Button title="Block" variant="danger" onPress={confirmBlock} style={styles.actionBtn} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  trustBlock: { marginBottom: space.xl },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xxxl, marginBottom: space.xl },
  actionBtn: { flex: 1 },
});
