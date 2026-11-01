/**
 * Dibbs buying team: one private offer request. Shows everything the seller
 * sent, the estimate / meetup / final offer / payout as separate facts, the full
 * timeline with internal notes, and the actions valid for the current status.
 * Every action carries the version staff were looking at; a CONFLICT means
 * someone else got there first, so the latest is reloaded and shown.
 */
import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FileQuestion } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { RefetchBanner } from '@/components/ui/RefetchBanner';
import { StaffGate } from '@/components/dibbs-staff/StaffGate';
import { MediaGrid } from '@/components/dibbs-staff/MediaGrid';
import { Timeline } from '@/components/dibbs-staff/Timeline';
import { ActionsPanel, type ActionError, type StaffActionInput } from '@/components/dibbs-staff/ActionsPanel';
import { FactsSection, HeaderBlock, ItemSection, ListingSection, SectionCard, SellerSection } from '@/components/dibbs-staff/DetailSections';
import { trpc } from '@/lib/trpc';
import { breakpoints, space } from '@/constants/theme';

export default function DibbsOfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <StaffGate returnTo={`/staff/dibbs-offers/${id}`}>
      <Stack.Screen options={{ title: 'Dibbs offer' }} />
      <Detail id={String(id)} />
    </StaffGate>
  );
}

function Detail({ id }: { id: string }) {
  const { width } = useWindowDimensions();
  const twoColumns = width >= breakpoints.xl;
  const utils = trpc.useUtils();
  const [error, setError] = useState<ActionError | null>(null);

  const query = trpc.dibbsStaff.byId.useQuery({ id });
  const act = trpc.dibbsStaff.act.useMutation();
  const note = trpc.dibbsStaff.addNote.useMutation();
  const busy = act.isPending || note.isPending;

  const refreshQueue = () => void utils.dibbsStaff.queue.invalidate();

  const onAct = (action: StaffActionInput, version: number, onDone: () => void) => {
    setError(null);
    act.mutate(
      { id, expectedVersion: version, action },
      {
        onSuccess: (data) => {
          onDone();
          utils.dibbsStaff.byId.setData({ id }, data);
          refreshQueue();
        },
        onError: (err) => {
          const conflict = err.data?.code === 'CONFLICT';
          setError({ message: err.message, conflict });
          if (conflict) void utils.dibbsStaff.byId.invalidate({ id });
          refreshQueue();
        },
      },
    );
  };

  const onAddNote = (message: string, onDone: () => void) => {
    setError(null);
    note.mutate(
      { id, message },
      {
        onSuccess: (data) => {
          onDone();
          utils.dibbsStaff.byId.setData({ id }, data);
        },
        onError: (err) => setError({ message: err.message, conflict: false }),
      },
    );
  };

  if (query.isPending) {
    return (
      <Screen scroll maxWidth={twoColumns ? 1140 : undefined}>
        <View style={styles.loading}>
          <Skeleton height={28} width="60%" />
          <Skeleton height={240} radius={14} />
          <Skeleton height={120} radius={20} />
          <Skeleton height={160} radius={20} />
        </View>
      </Screen>
    );
  }

  if (query.isError && !query.data) {
    const missing = query.error.data?.code === 'NOT_FOUND';
    return (
      <Screen>
        {missing ? (
          <EmptyState
            icon={<FileQuestion size={40} />}
            title="Request not found"
            body="It may have been removed, or the link is wrong."
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </Screen>
    );
  }

  const d = query.data!;

  const actions = (
    <ActionsPanel
      detail={d}
      busy={busy}
      error={error}
      onDismissError={() => setError(null)}
      onAct={onAct}
      onAddNote={onAddNote}
    />
  );
  const media = (
    <SectionCard title={`Photos and video (${d.media.length})`}>
      <MediaGrid media={d.media} />
    </SectionCard>
  );
  const timeline = (
    <SectionCard title="Timeline">
      <Timeline events={d.timeline} timezone={d.timezone} />
    </SectionCard>
  );

  return (
    <Screen scroll maxWidth={twoColumns ? 1140 : undefined} contentContainerStyle={styles.content}>
      {query.isError ? <RefetchBanner onRetry={() => query.refetch()} /> : null}
      <HeaderBlock d={d} />
      {twoColumns ? (
        <View style={styles.columns}>
          <View style={styles.colMain}>
            {media}
            <ItemSection d={d} />
            <ListingSection d={d} />
            {timeline}
          </View>
          <View style={styles.colSide}>
            <FactsSection d={d} />
            {actions}
            <SellerSection d={d} />
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          {media}
          <ItemSection d={d} />
          <SellerSection d={d} />
          <ListingSection d={d} />
          <FactsSection d={d} />
          {actions}
          {timeline}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.section },
  loading: { gap: space.md, paddingTop: space.lg },
  stack: { gap: space.lg },
  columns: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  colMain: { flex: 3, gap: space.lg },
  colSide: { flex: 2, gap: space.lg },
});
