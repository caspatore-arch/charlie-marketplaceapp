/**
 * Create-listing modal route. Requires auth (redirects to sign-in with
 * returnTo if signed out). Publishes via `listing.create`, then invalidates
 * the feed/mine/byId caches and replaces navigation into the new listing's
 * detail page so back doesn't return to this form.
 */
import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { ListingForm, type ListingFormSubmitValues } from '@/components/sell/ListingForm';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';

export default function NewListingScreen() {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const { status } = useAuth();
  const utils = trpc.useUtils();

  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      router.replace(`/listing/${listing.id}`);
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

  if (status !== 'signedIn') {
    return <Screen>{null}</Screen>;
  }

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title: 'New listing',
          headerLeft: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={handleCancel} hitSlop={8}>
              <Text variant="body" color="accent">
                Cancel
              </Text>
            </Pressable>
          ),
        }}
      />
      <ListingForm
        submitLabel="Publish"
        submitting={createMutation.isPending}
        submitError={submitError}
        onSubmit={handleSubmit}
        onDirtyChange={setDirty}
      />
    </Screen>
  );
}
