/**
 * Moderation screen (moderators only; community-post reports get a Remove post action): segmented Open / Reviewed list of
 * reports from `moderation.reports`, with Dismiss / Remove listing / Add
 * note actions on open reports via `moderation.reviewReport`. Gated by
 * `moderation.isModerator` — non-moderators (or a FORBIDDEN response) see an
 * explanatory state rather than the list. Linked from the Profile screen.
 */
import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
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
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <Stack.Screen options={{ title: 'Moderation' }} />
      <View style={styles.header}>
        <Text variant="title">Moderation</Text>
      </View>

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

function ModeratorReports() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('open');
  const [actionSheet, setActionSheet] = useState<{ report: ModerationReport; mode: 'remove_listing' | 'note' } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const status = tab === 'open' ? 'open' : 'reviewed';
  const reportsQuery = trpc.moderation.reports.useQuery({ status });

  const invalidate = () => utils.moderation.reports.invalidate();

  const reviewMutation = trpc.moderation.reviewReport.useMutation({
    onSuccess: () => {
      setActionError(null);
      setActionSheet(null);
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });

  const [removingPostId, setRemovingPostId] = useState<string | null>(null);
  const removePostMutation = trpc.community.moderatorRemove.useMutation({
    onError: (err) => setActionError(err.message),
  });
  const onRemovePost = (report: ModerationReport) => {
    const postId = report.targetPostId;
    if (!postId) return;
    confirmAction('Remove this community post?', 'It disappears from the feed for everyone.', 'Remove', () => {
      setActionError(null);
      setRemovingPostId(report.id);
      removePostMutation.mutate(
        { id: postId },
        {
          onSuccess: () =>
            reviewMutation.mutate({ id: report.id, action: 'note', note: 'Community post removed.' }),
          onSettled: () => setRemovingPostId(null),
        },
      );
    });
  };

  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const goToTarget = (report: ModerationReport) => {
    if (report.targetListing) {
      router.push(`/listing/${report.targetListing.id}`);
    } else if (report.targetUser) {
      router.push(`/user/${report.targetUser.id}`);
    }
  };

  const onDismiss = (report: ModerationReport) => {
    confirmAction(
      'Dismiss this report?',
      'No action will be taken against the listing or account.',
      'Dismiss',
      () => {
        setActionError(null);
        setDismissingId(report.id);
        reviewMutation.mutate(
          { id: report.id, action: 'dismiss' },
          { onSettled: () => setDismissingId(null) },
        );
      },
      { cancelLabel: 'Keep it', destructive: false },
    );
  };

  return (
    <>
      <View style={styles.tabsWrap}>
        <SegmentedTabs
          segments={[
            { key: 'open', label: 'Open' },
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
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <ReportCard
              report={item}
              onPressTarget={() => goToTarget(item)}
              actions={
                tab === 'open'
                  ? {
                      dismissing: reviewMutation.isPending && dismissingId === item.id,
                      removing:
                        reviewMutation.isPending &&
                        actionSheet?.report.id === item.id &&
                        actionSheet.mode === 'remove_listing',
                      removingPost: removingPostId === item.id,
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
        loading={reviewMutation.isPending}
        onClose={() => setActionSheet(null)}
        onSubmit={(note) => {
          if (!actionSheet) return;
          reviewMutation.mutate({
            id: actionSheet.report.id,
            action: actionSheet.mode,
            note: note || undefined,
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
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
