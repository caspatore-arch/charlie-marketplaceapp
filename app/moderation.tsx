/**
 * Moderation screen (moderators only): segmented Open (n) / Reviewed (n) list
 * of reports from `moderation.reports`, pull-to-refresh, and Dismiss / Remove
 * listing / Remove post / Add note actions on open reports via
 * `moderation.reviewReport`. One `pendingReportId` disables every card's
 * actions while any mutation runs. Removing a post is two server calls
 * (`community.moderatorRemove` then `reviewReport`); the second is retried and
 * can be re-run safely, so a removed post never leaves its report open.
 * Gated by `moderation.isModerator`. Linked from the Profile screen.
 */
import React, { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { ShieldAlert } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { SegmentedTabs } from '@/components/inbox/SegmentedTabs';
import { ReportCard } from '@/components/moderation/ReportCard';
import { ModerationActionSheet } from '@/components/moderation/ModerationActionSheet';
import { confirmAction } from '@/utils/confirm';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';
import type { ModerationReport } from '@/types';

type Tab = 'open' | 'reviewed';

export default function ModerationScreen() {
  const isModeratorQuery = trpc.moderation.isModerator.useQuery();

  return (
    <Screen edges={['left', 'right']} padded={false}>
      <Stack.Screen options={{ title: 'Moderation' }} />

      {isModeratorQuery.isPending ? (
        <View style={styles.loadingWrap}>
          <Skeleton height={44} radius={12} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </View>
      ) : isModeratorQuery.isError ? (
        isModeratorQuery.error.data?.code === 'FORBIDDEN' ? (
          <ForbiddenState />
        ) : (
          <ErrorState message={isModeratorQuery.error.message} onRetry={() => isModeratorQuery.refetch()} />
        )
      ) : isModeratorQuery.data ? (
        <ModeratorReports />
      ) : (
        <ForbiddenState />
      )}
    </Screen>
  );
}

function ForbiddenState() {
  return (
    <EmptyState
      icon={<ShieldAlert size={40} color={colors.inkFaint} />}
      title="Moderator access required"
      body="This section is only visible to people with moderation access on this campus."
    />
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ModeratorReports() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('open');
  const [actionSheet, setActionSheet] = useState<{ report: ModerationReport; mode: 'remove_listing' | 'note' } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  // One id for whichever report has a mutation in flight; all cards disable.
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const utils = trpc.useUtils();
  const openQuery = trpc.moderation.reports.useQuery({ status: 'open' });
  const reviewedQuery = trpc.moderation.reports.useQuery({ status: 'reviewed' });
  const reportsQuery = tab === 'open' ? openQuery : reviewedQuery;

  const invalidate = () => utils.moderation.reports.invalidate();

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([openQuery.refetch(), reviewedQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const reviewMutation = trpc.moderation.reviewReport.useMutation();
  const review = (
    report: ModerationReport,
    vars: { action: 'dismiss' | 'remove_listing' | 'note'; note?: string },
    after?: () => void,
  ) => {
    setActionError(null);
    setPendingReportId(report.id);
    reviewMutation.mutate(
      { id: report.id, ...vars },
      {
        onSuccess: () => {
          after?.();
          void invalidate();
        },
        onError: (err) => setActionError(err.message),
        onSettled: () => setPendingReportId(null),
      },
    );
  };

  const removePostMutation = trpc.community.moderatorRemove.useMutation();
  const onRemovePost = (report: ModerationReport) => {
    const postId = report.targetPostId;
    if (!postId) return;
    confirmAction('Remove this community post?', 'It disappears from the feed for everyone.', 'Remove', async () => {
      setActionError(null);
      setPendingReportId(report.id);
      try {
        await removePostMutation.mutateAsync({ id: postId });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not remove the post.');
        setPendingReportId(null);
        return;
      }
      // The post is gone. Close the report even if the first attempt fails.
      let closed = false;
      for (let attempt = 0; attempt < 3 && !closed; attempt++) {
        try {
          await reviewMutation.mutateAsync({ id: report.id, action: 'note', note: 'Community post removed.' });
          closed = true;
        } catch {
          if (attempt < 2) await sleep(400 * (attempt + 1));
        }
      }
      if (!closed) {
        setActionError('The post was removed, but the report could not be closed. Tap Remove post again to retry.');
      }
      setPendingReportId(null);
      void invalidate();
    });
  };

  const goToTarget = (report: ModerationReport) => {
    if (report.targetListing) {
      router.push(`/listing/${report.targetListing.id}`);
    } else if (report.targetUser) {
      // A reported post has no page of its own; open its author.
      router.push(`/user/${report.targetUser.id}`);
    }
  };

  const onDismiss = (report: ModerationReport) => {
    confirmAction(
      'Dismiss this report?',
      'No action will be taken against the listing or account.',
      'Dismiss',
      () => review(report, { action: 'dismiss' }),
      { cancelLabel: 'Keep it', destructive: false },
    );
  };

  return (
    <>
      <View style={styles.tabsWrap}>
        <SegmentedTabs
          segments={[
            { key: 'open', label: 'Open', badge: openQuery.data?.length || undefined, badgeLabel: 'open reports' },
            { key: 'reviewed', label: 'Reviewed' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {actionError ? (
        <View style={styles.errorBanner}>
          <Text variant="body" color="danger">
            {actionError}
          </Text>
        </View>
      ) : null}

      {reportsQuery.isPending ? (
        <View style={styles.loadingWrap}>
          <Skeleton height={140} />
          <Skeleton height={140} />
        </View>
      ) : reportsQuery.isError ? (
        <ErrorState message={reportsQuery.error.message} onRetry={() => reportsQuery.refetch()} />
      ) : (reportsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title={tab === 'open' ? 'No open reports' : 'No reviewed reports yet'}
          body={
            tab === 'open'
              ? 'Reports from users will show up here when there is something to look at.'
              : 'Reports you act on will show up here.'
          }
        />
      ) : (
        <FlatList
          data={reportsQuery.data}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <ReportCard
              report={item}
              onPressTarget={() => goToTarget(item)}
              actions={
                tab === 'open'
                  ? {
                      busy: pendingReportId !== null,
                      pending: pendingReportId === item.id,
                      onRemovePost: () => onRemovePost(item),
                      onDismiss: () => onDismiss(item),
                      onRemoveListing: () => {
                        setActionError(null);
                        setActionSheet({ report: item, mode: 'remove_listing' });
                      },
                      onAddNote: () => {
                        setActionError(null);
                        setActionSheet({ report: item, mode: 'note' });
                      },
                    }
                  : undefined
              }
            />
          )}
        />
      )}

      <ModerationActionSheet
        visible={!!actionSheet}
        mode={actionSheet?.mode ?? 'note'}
        loading={!!actionSheet && pendingReportId === actionSheet.report.id}
        onClose={() => setActionSheet(null)}
        onSubmit={(note) => {
          if (!actionSheet) return;
          review(actionSheet.report, { action: actionSheet.mode, note: note || undefined }, () =>
            setActionSheet(null),
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  tabsWrap: { paddingHorizontal: space.lg, marginBottom: space.md },
  loadingWrap: { gap: space.md, paddingHorizontal: space.lg },
  errorBanner: {
    marginHorizontal: space.lg,
    marginBottom: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    padding: space.md,
  },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.huge, gap: space.md },
});
