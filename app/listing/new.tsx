/**
 * Create-listing modal route. Requires auth (redirects to sign-in with
 * returnTo if signed out). Publishes via `listing.create`, then invalidates
 * the feed/mine/byId caches and shows the post-publish celebration modal,
 * whose buttons replace navigation into the listing (or the feed) so back
 * doesn't return to this form.
 *
 * Selling needs a verified campus email (campusVerifiedProcedure). An account
 * without one (any-email or phone sign-in) gets the verify step here first,
 * instead of filling in a whole listing only to be refused on Publish.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { CampusEmailVerify } from '@/components/auth/CampusEmailVerify';
import { space } from '@/constants/theme';
import { Screen } from '@/components/ui/Screen';
import { TextLink } from '@/components/ui/TextLink';
import { GuardedCloseButton } from '@/components/sell/GuardedCloseButton';
import { ListingForm, type ListingFormSubmitValues } from '@/components/sell/ListingForm';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { FirstPostTutorial } from '@/components/sell/FirstPostTutorial';
import { PostPublishModal, type PublishedListing } from '@/components/share/PostPublishModal';

export default function NewListingScreen() {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { status, user } = useAuth();
  const utils = trpc.useUtils();

  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishedListing | null>(null);
  const [tipsReplay, setTipsReplay] = useState(0);

  useEffect(() => {
    if (status === 'signedOut') {
      requireAuth('/listing/new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createMutation = trpc.listing.create.useMutation({
    onSuccess: async (listing) => {
      await Promise.all([
        utils.listing.feed.invalidate(),
        utils.listing.mine.invalidate(),
        utils.listing.byId.invalidate({ id: listing.id }),
      ]);
      // Celebrate first; the modal's buttons navigate. The form stays mounted
      // behind it only until one of them is pressed.
      setPublished({
        id: listing.id,
        title: listing.title,
        priceCents: listing.priceCents,
        coverPhotoUrl: listing.coverPhotoUrl ?? null,
      });
    },
    onError: (err) => setSubmitError(err.message),
  });

  function handleSubmit(values: ListingFormSubmitValues) {
    setSubmitError(null);
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

  if (user && !user.campusEmailVerifiedAt) {
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
        submitting={createMutation.isPending}
        submitError={submitError}
        onSubmit={handleSubmit}
        onDirtyChange={setDirty}
      />
      <PostPublishModal listing={published} onViewListing={viewPublished} onBackToFeed={backToFeed} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { gap: space.md, paddingTop: space.lg },
});
