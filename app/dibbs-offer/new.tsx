/**
 * "Get a Dibbs offer": a PRIVATE request to the Dibbs buying team
 * (route `/dibbs-offer/new`, optional `?listingId=` for one of your own listings).
 *
 * Photos (up to 8) and at most one short video (30 s) upload as you pick them.
 * Nothing here is posted publicly: only you and authorized Dibbs staff can see
 * the request. There is no asking price; the team replies with an estimate that
 * is always subject to inspection. `dibbsOffer.create` is idempotent per
 * `clientRequestId`, generated once per form, so a double tap or retry can't
 * send two requests.
 *
 * Same account gates as `/listing/new` (signed in, not blocked, verified email).
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import { CheckCircle2, Lock } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Divider } from '@/components/ui/Divider';
import { Input, TextArea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { CampusEmailVerify } from '@/components/auth/CampusEmailVerify';
import { GuardedCloseButton } from '@/components/sell/GuardedCloseButton';
import { PrivateMediaPicker, usePrivateMediaUploads } from '@/components/dibbs/PrivateMediaPicker';
import { ServerErrorNote, type ServerErrorLike } from '@/components/offers/ServerErrorNote';
import { CONDITIONS, CONDITION_LABELS, type Condition } from '@/constants/campus';
import { colors, radius, space } from '@/constants/theme';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { resolveMediaUrl, trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';

const NAME_MIN = 2;
const NAME_MAX = 80;
const SPECS_MAX = 300;
const DESCRIPTION_MAX = 1000;

export default function NewDibbsOfferScreen() {
  const router = useRouter();
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  const { status, user } = useAuth();
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();

  // `null` / `undefined` = untouched, so a listing prefill shows until the seller edits it.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [conditionEdit, setConditionEdit] = useState<Condition | null | undefined>(undefined);
  const [specs, setSpecs] = useState('');
  const [description, setDescription] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<ServerErrorLike | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  // One id per form: retries and double taps resolve to the same request.
  const [clientRequestId] = useState(() => Crypto.randomUUID());
  const uploads = usePrivateMediaUploads();

  useEffect(() => {
    if (status === 'signedOut') {
      requireAuth(listingId ? `/dibbs-offer/new?listingId=${encodeURIComponent(listingId)}` : '/dibbs-offer/new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const listingQuery = trpc.listing.byId.useQuery({ id: listingId! }, { enabled: !!listingId && status === 'signedIn' });
  const listing = listingQuery.data;
  const itemName = nameEdit ?? listing?.title.slice(0, NAME_MAX) ?? '';
  const condition: Condition | null = conditionEdit === undefined ? ((listing?.condition as Condition | undefined) ?? null) : conditionEdit;

  const createMutation = trpc.dibbsOffer.create.useMutation({
    onSuccess: async (detail) => {
      await Promise.all([
        utils.dibbsOffer.mine.invalidate(),
        utils.dibbsOffer.forListing.invalidate(),
        ...(listingId ? [utils.listing.byId.invalidate({ id: listingId })] : []),
      ]);
      setSentId(detail.id);
    },
    onError: (err) => setError(err),
  });

  const trimmedName = itemName.trim();
  const nameOk = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX;
  const mediaOk = uploads.doneIds.length > 0 || !!listingId;
  const blockedBy = !nameOk
    ? 'Add the item’s name to continue.'
    : uploads.uploading
      ? 'Waiting for your uploads to finish.'
      : uploads.failed
        ? 'Try again or remove the photo that didn’t upload.'
        : !mediaOk
          ? 'Add at least one photo or a short video to continue.'
          : null;
  const dirty =
    !sentId &&
    (itemName.trim() !== '' || condition !== null || specs.trim() !== '' || description.trim() !== '' || uploads.items.length > 0);

  function submit() {
    if (blockedBy || createMutation.isPending) return;
    setError(null);
    createMutation.mutate({
      clientRequestId,
      itemName: trimmedName,
      condition: condition ?? undefined,
      specs: specs.trim() || undefined,
      description: description.trim() || undefined,
      mediaIds: uploads.doneIds,
      listingId: listingId || undefined,
    });
  }

  function close() {
    const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
    if (dirty) {
      confirmAction('Discard this request?', 'Your photos and details will be lost.', 'Discard', leave, {
        cancelLabel: 'Keep editing',
      });
    } else {
      leave();
    }
  }

  const closeButton = () => <GuardedCloseButton onPress={close} label="Close" />;

  if (status !== 'signedIn') {
    return <Screen>{null}</Screen>;
  }

  if (user && user.postingStatus === 'blocked') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Get a Dibbs offer', headerLeft: closeButton }} />
        <View style={styles.gate}>
          <Text variant="title">You can’t sell right now</Text>
          <Text variant="body" color="inkMuted">
            Your account can’t buy, sell or post right now. Contact support.
          </Text>
        </View>
      </Screen>
    );
  }

  if (user && !user.canPost) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Get a Dibbs offer', headerLeft: closeButton }} />
        <View style={styles.gate}>
          <Text variant="title">Verify your campus email first</Text>
          <Text variant="body" color="inkMuted">
            Requests to the Dibbs team need a verified campus email. Add yours and you can send your request right after.
          </Text>
          <CampusEmailVerify
            showExplainer={false}
            onDone={() => undefined}
            onSkip={() => router.back()}
            skipLabel="Not now"
            doneLabel="Start my request"
          />
        </View>
      </Screen>
    );
  }

  // ---- Sent
  if (sentId) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen
          options={{
            title: 'Request sent',
            gestureEnabled: false,
            headerLeft: () => <GuardedCloseButton onPress={() => router.replace('/')} label="Close" />,
          }}
        />
        <View style={styles.sentHeader}>
          <CheckCircle2 size={32} color={colors.success} />
          <Text variant="title" accessibilityRole="header">
            Request sent
          </Text>
        </View>
        <Card style={styles.gap}>
          <Text variant="body">
            The Dibbs team will review it by hand. They aim to reply within about an hour, but that isn’t guaranteed.
          </Text>
          <Text variant="body" color="inkMuted">
            Your request is private. Only you and authorized Dibbs staff can see it. You’ll see the reply on the request
            page, and you can say no or withdraw at any time.
          </Text>
        </Card>
        <Button title="View my request" size="lg" onPress={() => router.replace(`/dibbs-offer/${sentId}`)} />
        <Button title="Back to Browse" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  // ---- Listing prefill states
  if (listingId && listingQuery.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Get a Dibbs offer', headerLeft: closeButton }} />
        <ErrorState message={listingQuery.error.message} onRetry={() => listingQuery.refetch()} />
      </Screen>
    );
  }
  if (listingId && listingQuery.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Get a Dibbs offer', headerLeft: closeButton }} />
        <View style={styles.gap}>
          <Skeleton height={72} />
          <Skeleton height={160} />
        </View>
      </Screen>
    );
  }

  const nameError =
    nameTouched && trimmedName.length > 0 && trimmedName.length < NAME_MIN
      ? 'The name needs at least 2 characters.'
      : undefined;

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: 'Get a Dibbs offer',
          gestureEnabled: !dirty && !createMutation.isPending,
          headerLeft: closeButton,
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView style={styles.flex} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.privacy} accessible accessibilityLabel="Private request. Only you and authorized Dibbs staff can see it. It isn’t posted publicly.">
            <Lock size={18} color={colors.accentInk} />
            <View style={styles.privacyText}>
              <Text variant="label" weight="600">
                Private request
              </Text>
              <Text variant="caption" color="inkMuted">
                It stays between you and authorized Dibbs staff. It isn’t posted publicly and never appears in Browse,
                the Archive, profiles or search.
              </Text>
            </View>
          </View>

          {listing ? (
            <View style={styles.listingRow}>
              <Image
                source={{ uri: resolveMediaUrl(listing.photos[0]?.url) }}
                style={styles.thumb}
                contentFit="cover"
                accessibilityLabel={`Photo of ${listing.title}`}
              />
              <Text variant="body" color="inkMuted" style={styles.listingText}>
                This is for your listing “{listing.title}”. Its photos are sent to the team, so adding more is optional.
              </Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text variant="label" color="inkMuted">
              {listingId ? 'More photos or a short video (optional)' : 'Photos or a short video'}
            </Text>
            <PrivateMediaPicker uploads={uploads} />
          </View>

          <Divider />

          <Input
            label="What is it?"
            placeholder="e.g. MacBook Air 13-inch"
            value={itemName}
            onChangeText={setNameEdit}
            onBlur={() => setNameTouched(true)}
            error={nameError}
            maxLength={NAME_MAX}
            returnKeyType="next"
            autoCapitalize="sentences"
          />

          <View style={styles.section}>
            <Text variant="label" color="inkMuted">
              Condition (optional)
            </Text>
            <View style={styles.chipWrap}>
              {CONDITIONS.map((c) => (
                <Chip
                  key={c}
                  label={CONDITION_LABELS[c]}
                  selected={condition === c}
                  onPress={() => setConditionEdit(condition === c ? null : c)}
                />
              ))}
            </View>
          </View>

          <Input
            label="Model or specifications (optional)"
            placeholder="e.g. M2, 16 GB, 512 GB"
            value={specs}
            onChangeText={setSpecs}
            maxLength={SPECS_MAX}
          />

          <TextArea
            label="Anything else? (optional)"
            placeholder="What’s included, any flaws or wear, how old it is"
            value={description}
            onChangeText={setDescription}
            maxLength={DESCRIPTION_MAX}
          />

          <Card style={styles.gap}>
            <Text variant="label" weight="600">
              What happens next
            </Text>
            <Text variant="bodySm" color="inkMuted">
              The team reviews each request by hand and aims to reply within about an hour, but that isn’t guaranteed.
              They may send an estimate, ask a question, or pass. Any estimate is subject to inspection, and you can say
              no at any point. If it’s a good fit, Dibbs may be able to buy it the same day.
            </Text>
          </Card>

          <ServerErrorNote error={error} />

          <Button
            title="Request an offer"
            size="lg"
            onPress={submit}
            loading={createMutation.isPending}
            disabled={!!blockedBy}
            accessibilityLabel={blockedBy ? `Request an offer. ${blockedBy}` : 'Request an offer'}
          />
          {blockedBy ? (
            <Text variant="caption" color="inkMuted" style={styles.hint}>
              {blockedBy}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gate: { gap: space.md, paddingTop: space.lg },
  content: { gap: space.xl, paddingBottom: space.huge, paddingTop: space.lg },
  form: { padding: space.lg, paddingBottom: space.huge, gap: space.xl },
  gap: { gap: space.md },
  section: { gap: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { textAlign: 'center', marginTop: -space.md },
  sentHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  privacy: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  privacyText: { flex: 1, gap: 2 },
  listingRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  listingText: { flex: 1 },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
});
