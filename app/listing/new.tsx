/**
 * Create-listing modal route. Requires auth (redirects to sign-in with
 * returnTo if signed out). Publishes via `listing.create`, then invalidates
 * the feed/mine/byId caches and shows the post-publish celebration modal,
 * whose buttons replace navigation into the listing (or the feed) so back
 * doesn't return to this form.
 *
 * Selling needs a verified email (campus or any other) or a founder approval
 * (campusVerifiedProcedure; `user.canPost` mirrors it). A phone-only account
 * without either gets the campus-email verify step here first,
 * instead of filling in a whole listing only to be refused on Publish. A
 * blocked account gets a plain "can't sell" note instead.
 *
 * After those gates, a two-card choice comes first: "List on Dibbs" (this
 * form) or "Get a Dibbs offer" (private request, /dibbs-offer/new). `?mode=list`
 * skips the choice. The list form has an unchecked "Also get a Dibbs offer"
 * box: if ticked, `dibbsOffer.create` runs after the listing publishes, and a
 * failure there never undoes the listing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { ChevronRight, Send, Tag } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { CampusEmailVerify } from '@/components/auth/CampusEmailVerify';
import { colors, space } from '@/constants/theme';
import { Screen } from '@/components/ui/Screen';
import { TextLink } from '@/components/ui/TextLink';
import { GuardedCloseButton } from '@/components/sell/GuardedCloseButton';
import { ListingForm, type ListingFormSubmitValues } from '@/components/sell/ListingForm';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { FirstPostTutorial } from '@/components/sell/FirstPostTutorial';
import { PostPublishModal, type PublishedListing } from '@/components/share/PostPublishModal';
import { AlsoDibbsOfferCheckbox } from '@/components/dibbs/AlsoDibbsOfferCheckbox';

/** Shows a short note, then runs `next` once (web has no multi-button Alert). */
function noteThen(title: string, message: string, next: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    next();
    return;
  }
  let done = false;
  const once = () => {
    if (!done) {
      done = true;
      next();
    }
  };
  Alert.alert(title, message, [{ text: 'OK', onPress: once }], { cancelable: true, onDismiss: once });
}

export default function NewListingScreen() {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { status, user } = useAuth();
  const utils = trpc.useUtils();

  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishedListing | null>(null);
  const [tipsReplay, setTipsReplay] = useState(0);
  // `?mode=list` skips the choice and goes straight to the public listing form.
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'choose' | 'list'>(modeParam === 'list' ? 'list' : 'choose');
  // "Also get a Dibbs offer": unchecked by default. One request id per form,
  // so a retry can never create a second request.
  const [alsoDibbs, setAlsoDibbs] = useState(false);
  const alsoDibbsAtSubmit = useRef(false);
  const [dibbsRequestId] = useState(() => Crypto.randomUUID());
  const dibbsCreate = trpc.dibbsOffer.create.useMutation();

  useEffect(() => {
    if (status === 'signedOut') {
      requireAuth('/listing/new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createMutation = trpc.listing.create.useMutation({
    onSuccess: async (listing, variables) => {
      await Promise.all([
        utils.listing.feed.invalidate(),
        utils.listing.mine.invalidate(),
        utils.listing.byId.invalidate({ id: listing.id }),
      ]);
      const celebrate = () =>
        // Celebrate first; the modal's buttons navigate. The form stays mounted
        // behind it only until one of them is pressed.
        setPublished({
          id: listing.id,
          title: listing.title,
          priceCents: listing.priceCents,
          coverPhotoUrl: listing.coverPhotoUrl ?? null,
        });
      if (!alsoDibbsAtSubmit.current) {
        celebrate();
        return;
      }
      // The listing is already live. If the private Dibbs request fails, say so
      // plainly and carry on; it never undoes the listing.
      try {
        await dibbsCreate.mutateAsync({
          clientRequestId: dibbsRequestId,
          listingId: listing.id,
          itemName: variables.title,
          condition: variables.condition,
          description: variables.description,
        });
        await Promise.all([utils.dibbsOffer.mine.invalidate(), utils.dibbsOffer.forListing.invalidate()]);
        celebrate();
      } catch (err) {
        const why = err instanceof Error && err.message ? ` ${err.message}` : '';
        noteThen(
          'Your listing is live',
          `The Dibbs offer request didn’t go through.${why} You can send it again from Profile, under Dibbs offer requests.`,
          celebrate,
        );
      }
    },
    onError: (err) => setSubmitError(err.message),
  });

  function handleSubmit(values: ListingFormSubmitValues) {
    setSubmitError(null);
    alsoDibbsAtSubmit.current = alsoDibbs;
    createMutation.mutate(values);
  }

  function handleCancel() {
    if (dirty) {
      confirmAction('Discard this listing?', 'Your photos and details will be lost.', 'Discard', () => router.back(), {
        cancelLabel: 'Keep editing',
      });
    } else {
      router.back();
    }
  }

  function viewPublished() {
    if (!published) return;
    const id = published.id;
    setPublished(null);
    router.replace(`/listing/${id}`);
  }

  function backToFeed() {
    setPublished(null);
    router.replace('/');
  }

  if (status !== 'signedIn') {
    return <Screen>{null}</Screen>;
  }

  if (user && user.postingStatus === 'blocked') {
    return (
      <Screen>
        <Stack.Screen
          options={{ title: 'New listing', headerLeft: () => <GuardedCloseButton onPress={() => router.back()} label="Close" /> }}
        />
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
        <Stack.Screen
          options={{ title: 'New listing', headerLeft: () => <GuardedCloseButton onPress={() => router.back()} label="Close" /> }}
        />
        <View style={styles.gate}>
          <Text variant="title">Verify your campus email to sell</Text>
          <Text variant="body" color="inkMuted">
            Selling needs a verified campus email. Add yours and you can post right after.
          </Text>
          <CampusEmailVerify
            showExplainer={false}
            onDone={() => undefined}
            onSkip={() => router.back()}
            skipLabel="Not now"
            doneLabel="Start my listing"
          />
        </View>
      </Screen>
    );
  }

  if (mode === 'choose') {
    return (
      <Screen scroll contentContainerStyle={styles.choose}>
        <Stack.Screen
          options={{ title: 'Sell', headerLeft: () => <GuardedCloseButton onPress={() => router.back()} label="Close" /> }}
        />
        <Text variant="title" accessibilityRole="header">
          How do you want to sell it?
        </Text>
        <Card
          onPress={() => setMode('list')}
          style={styles.choiceCard}
          accessibilityLabel="List on Dibbs. Post it for everyone on campus. It's live for 24 hours and you meet buyers yourself."
        >
          <View style={styles.choiceIcon}>
            <Tag size={22} color={colors.accentInk} />
          </View>
          <View style={styles.choiceText}>
            <Text variant="heading">List on Dibbs</Text>
            <Text variant="bodySm" color="inkMuted">
              Post it for everyone on campus. It&apos;s live for 24 hours, you set the price, and you meet buyers
              yourself.
            </Text>
          </View>
          <ChevronRight size={20} color={colors.inkFaint} />
        </Card>
        <Card
          onPress={() => router.replace('/dibbs-offer/new')}
          style={styles.choiceCard}
          accessibilityLabel="Get a Dibbs offer. Send photos privately to the Dibbs team for an estimate. Nothing is posted publicly."
        >
          <View style={styles.choiceIcon}>
            <Send size={22} color={colors.accentInk} />
          </View>
          <View style={styles.choiceText}>
            <Text variant="heading">Get a Dibbs offer</Text>
            <Text variant="bodySm" color="inkMuted">
              Send photos privately to the Dibbs team and get an estimate. Nothing is posted publicly, and you can say
              no at any point.
            </Text>
          </View>
          <ChevronRight size={20} color={colors.inkFaint} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: 'New listing',
          headerLeft: () => <GuardedCloseButton onPress={handleCancel} label="Close" />,
          headerRight: () => (
            <TextLink variant="small" onPress={() => setTipsReplay((n) => n + 1)} accessibilityLabel="Tips for a great post">
              Tips
            </TextLink>
          ),
        }}
      />
      {user ? <FirstPostTutorial key={user.id} userId={user.id} replay={tipsReplay} /> : null}
      <ListingForm
        submitLabel="Publish"
        publishCaption="Live for 24 hours. Didn't sell? Repost it at a lower price."
        enableAutofill
        submitting={createMutation.isPending || dibbsCreate.isPending}
        submitError={submitError}
        onSubmit={handleSubmit}
        onDirtyChange={setDirty}
        footer={<AlsoDibbsOfferCheckbox checked={alsoDibbs} onChange={setAlsoDibbs} disabled={createMutation.isPending} />}
      />
      <PostPublishModal listing={published} onViewListing={viewPublished} onBackToFeed={backToFeed} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { gap: space.md, paddingTop: space.lg },
  choose: { gap: space.lg, paddingTop: space.lg, paddingBottom: space.huge },
  choiceCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 96 },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { flex: 1, gap: space.xs },
});
