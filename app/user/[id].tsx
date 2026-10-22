/**
 * Someone's profile: picture, bio, follow button and counts, a compact trust
 * line (with Details), then Listings / Posts / Comments tabs. Report and Block
 * live in the "…" menu in the header. Conversations are never shown here, for
 * anyone: they are private between two people.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MoreHorizontal } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextLink } from '@/components/ui/TextLink';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProfileSkeleton } from '@/components/ui/ProfileSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice } from '@/components/auth/Notice';
import { ReportSheet } from '@/components/browse/ReportSheet';
import { TrustBlock, TrustCompact } from '@/components/TrustSignals';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileContent } from '@/components/profile/ProfileContent';
import { FollowButton } from '@/components/profile/FollowButton';
import { FollowListPanel, type FollowDirection } from '@/components/profile/FollowListPanel';
import { trpc } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import { confirmAction } from '@/utils/confirm';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();

  const profileQuery = trpc.user.byId.useQuery({ id }, { enabled: !!id });
  const trustQuery = trpc.user.trustSummary.useQuery({ id }, { enabled: !!id });
  const blockedQuery = trpc.user.blocked.useQuery(undefined, { enabled: !!user });
  const [openList, setOpenList] = useState<FollowDirection | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const isBlocked = !!blockedQuery.data?.some((u) => u.id === id);

  const utils = trpc.useUtils();
  const refreshBlocks = () => {
    void utils.user.blocked.invalidate();
    void utils.user.byId.invalidate({ id });
    void utils.user.followList.invalidate();
    void utils.listing.feed.invalidate();
  };
  const blockMutation = trpc.user.block.useMutation({
    onSuccess: () => {
      refreshBlocks();
      setFeedback({ tone: 'success', text: 'Blocked. They can no longer message you or request meetups.' });
    },
    onError: (e) => setFeedback({ tone: 'error', text: `Could not block: ${e.message}` }),
  });
  const unblockMutation = trpc.user.unblock.useMutation({
    onSuccess: () => {
      refreshBlocks();
      setFeedback({ tone: 'success', text: 'Unblocked.' });
    },
    onError: (e) => setFeedback({ tone: 'error', text: `Could not unblock: ${e.message}` }),
  });
  const reportMutation = trpc.user.report.useMutation({
    onSuccess: () => {
      setReportOpen(false);
      setFeedback({ tone: 'success', text: 'Thanks. We’ll review this report.' });
    },
    onError: (e) => {
      setReportOpen(false);
      setFeedback({ tone: 'error', text: `Could not send the report: ${e.message}` });
    },
  });

  const confirmBlock = useCallback(() => {
    setMenuOpen(false);
    if (!requireAuth(`/user/${id}`)) return;
    confirmAction(
      'Block this user?',
      'They will no longer be able to message or request meetups with you.',
      'Block',
      () => blockMutation.mutate({ userId: id }),
    );
  }, [requireAuth, id, blockMutation]);

  const openReport = useCallback(() => {
    setMenuOpen(false);
    if (!requireAuth(`/user/${id}`)) return;
    setReportOpen(true);
  }, [requireAuth, id]);

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
      <Stack.Screen
        options={{
          title: profile.displayName,
          headerRight: isSelf
            ? undefined
            : () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More options"
                  onPress={() => setMenuOpen(true)}
                  hitSlop={8}
                  style={styles.menuBtn}
                >
                  <MoreHorizontal size={22} color={colors.ink} />
                </Pressable>
              ),
        }}
      />

      {feedback ? (
        <View style={styles.feedback}>
          <Notice tone={feedback.tone}>{feedback.text}</Notice>
        </View>
      ) : null}

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
          !isSelf && !profile.isClosed && !isBlocked ? (
            <FollowButton userId={profile.id} viewerFollows={profile.viewerFollows} displayName={profile.displayName} />
          ) : null
        }
      />

      {isBlocked && !isSelf ? (
        <View style={styles.blockedBar}>
          <Text variant="label" weight="600" style={styles.blockedText}>
            You blocked {firstName}
          </Text>
          <Button
            title="Unblock"
            variant="secondary"
            loading={unblockMutation.isPending}
            onPress={() => unblockMutation.mutate({ userId: id })}
          />
        </View>
      ) : null}

      {openList ? <FollowListPanel userId={profile.id} direction={openList} isSelf={isSelf} /> : null}

      {trustQuery.isPending ? (
        <Skeleton height={24} radius={radius.sm} style={styles.trustBlock} />
      ) : trustQuery.data ? (
        trustOpen ? (
          <View style={styles.trustBlock}>
            <TrustBlock summary={trustQuery.data} />
            <TextLink onPress={() => setTrustOpen(false)}>Hide details</TextLink>
          </View>
        ) : (
          <View style={styles.trustRow}>
            <View style={styles.trustLine}>
              <TrustCompact summary={trustQuery.data} />
            </View>
            <TextLink onPress={() => setTrustOpen(true)} accessibilityLabel="Show trust details">
              Details
            </TextLink>
          </View>
        )
      ) : null}

      <ProfileContent userId={profile.id} isSelf={isSelf} firstName={firstName} />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={profile.displayName}>
        <View style={styles.menu}>
          <Button title="Report" variant="secondary" onPress={openReport} />
          {isBlocked ? (
            <Button
              title="Unblock"
              variant="secondary"
              onPress={() => {
                setMenuOpen(false);
                unblockMutation.mutate({ userId: id });
              }}
            />
          ) : (
            <Button title="Block" variant="secondary" onPress={confirmBlock} />
          )}
        </View>
      </Sheet>

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this user"
        loading={reportMutation.isPending}
        onSubmit={(reason, details) => reportMutation.mutate({ targetUserId: id, reason, details })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  menuBtn: { width: minTouchHeight, height: minTouchHeight, alignItems: 'center', justifyContent: 'center' },
  feedback: { marginBottom: space.md },
  trustBlock: { marginBottom: space.xl },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginBottom: space.md },
  trustLine: { flex: 1 },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: space.md,
    marginBottom: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  blockedText: { flex: 1 },
  menu: { gap: space.md },
});
