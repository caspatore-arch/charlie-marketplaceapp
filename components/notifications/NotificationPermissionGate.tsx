/**
 * Mount once near the root of the app (see the exact `app/_layout.tsx` lines
 * reported in the handoff notes — that file isn't owned by this change).
 * Renders nothing. Two jobs:
 *
 * 1. Watches every tRPC mutation for the first one that implies "I want to
 *    hear back" — placing a bid, sending a message, requesting a meetup —
 *    and only then asks for notification permission (never on launch). This
 *    is done generically via react-query's MutationCache rather than by
 *    editing the bid sheet / composer / request-meetup screens, none of
 *    which this change owns.
 * 2. Listens for a tapped notification and deep-links to `data.path` via
 *    expo-router.
 *
 * Also silently re-registers the device token on sign-in when permission was
 * already granted in an earlier session (no prompt, just keeps the token /
 * `lastSeenAt` fresh).
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { usePushNotificationRegistration } from '@/hooks/useNotifications';
import { useAuth } from '@/hooks/useAuth';

// Foreground behavior: still show an alert/sound while the app is open.
// Guarded to native only — expo-notifications ships a web stub that would
// otherwise run harmlessly, but there is no foreground notification concept
// in a browser and this call should simply not happen there.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** tRPC paths whose first successful call should prompt for permission. */
const TRIGGER_PATHS = new Set(['bid.place', 'bid.buyout', 'conversation.send', 'reservation.request']);

export function NotificationPermissionGate() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { status } = useAuth();
  const { ensurePermissionAndRegister, registerIfAlreadyGranted } = usePushNotificationRegistration();
  const promptedRef = useRef(false);
  const silentRegisterRef = useRef<string | null>(null);

  // Job 1: prompt after the first qualifying mutation succeeds.
  useEffect(() => {
    const cache = queryClient.getMutationCache();
    const unsubscribe = cache.subscribe((event) => {
      if (status !== 'signedIn') return;
      if (event.type !== 'updated') return;
      if (event.mutation.state.status !== 'success') return;
      if (promptedRef.current) return;

      const key = event.mutation.options.mutationKey as unknown[] | undefined;
      const pathSegments = Array.isArray(key?.[0]) ? (key![0] as string[]) : undefined;
      const path = pathSegments?.join('.');
      if (!path || !TRIGGER_PATHS.has(path)) return;

      promptedRef.current = true;
      void ensurePermissionAndRegister();
    });
    return unsubscribe;
  }, [queryClient, status, ensurePermissionAndRegister]);

  // Job 1b: on sign-in, refresh the token silently if permission is already granted
  // (covers reinstalls / new sessions where the user decided long ago).
  useEffect(() => {
    if (status !== 'signedIn') return;
    if (silentRegisterRef.current === status) return;
    silentRegisterRef.current = status;
    void registerIfAlreadyGranted();
  }, [status, registerIfAlreadyGranted]);

  // Job 2: deep-link on notification tap.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { path?: string } | undefined;
      if (data?.path && typeof data.path === 'string') {
        router.push(data.path as never);
      }
    });
    return () => sub.remove();
  }, [router]);

  return null;
}

export default NotificationPermissionGate;
