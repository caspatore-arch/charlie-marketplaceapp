/**
 * Push notification registration.
 *
 * Requesting permission happens on demand — call `ensurePermissionAndRegister`
 * after the first action that implies the user wants to hear back (placing a
 * bid, sending a message, requesting a meetup). Never call it on app launch.
 *
 * Everything here degrades silently: no simulator/no physical device, denied
 * permission, no EAS project id configured, offline — all of it just returns
 * `false` and logs a warning. Nothing here should ever throw into a screen.
 *
 * Expo Go caveat (SDK 57, see docs.expo.dev/versions/v57.0.0/sdk/notifications):
 * remote push notifications do not work in Expo Go on iOS or Android — only in
 * a development build. `ensurePermissionAndRegister` will still resolve
 * (usually to `false`, since `getExpoPushTokenAsync` throws without a real EAS
 * project id) rather than crash the app in Expo Go.
 */
import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { trpc } from '@/lib/trpc';

export type DevicePlatform = 'ios' | 'android' | 'web' | 'unknown';

function currentPlatform(): DevicePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
}

/** Reads the EAS project id from app config, if one has been set up. */
function projectIdFromConfig(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export function usePushNotificationRegistration() {
  const registerMutation = trpc.notification.register.useMutation();
  const unregisterMutation = trpc.notification.unregister.useMutation();

  /**
   * Requests permission if it hasn't been decided yet (a no-op, no native
   * prompt, if the user already granted or already denied it — iOS/Android
   * both suppress a second system prompt on their own), then registers the
   * resulting Expo push token with the server. Returns whether a token ended
   * up registered.
   */
  const ensurePermissionAndRegister = useCallback(async (): Promise<boolean> => {
    try {
      if (!Device.isDevice) return false; // simulators/web preview can't get a real push token

      const current = await Notifications.getPermissionsAsync();
      let status = current.status;
      if (status !== 'granted' && current.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== 'granted') return false;

      const projectId = projectIdFromConfig();
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );

      await registerMutation.mutateAsync({
        expoPushToken: tokenResponse.data,
        platform: currentPlatform(),
      });
      return true;
    } catch (err) {
      // Expected in Expo Go (no remote push support) and in any environment
      // without an EAS project id — log and keep the app working silently.
      console.warn('[notifications] registration skipped:', err);
      return false;
    }
  }, [registerMutation]);

  /**
   * Registers silently, without ever showing a permission prompt — used to
   * refresh `lastSeenAt` / re-attach the token to the signed-in user when
   * permission was already granted in an earlier session.
   */
  const registerIfAlreadyGranted = useCallback(async (): Promise<boolean> => {
    try {
      if (!Device.isDevice) return false;
      const current = await Notifications.getPermissionsAsync();
      if (current.status !== 'granted') return false;

      const projectId = projectIdFromConfig();
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      await registerMutation.mutateAsync({
        expoPushToken: tokenResponse.data,
        platform: currentPlatform(),
      });
      return true;
    } catch (err) {
      console.warn('[notifications] silent registration skipped:', err);
      return false;
    }
  }, [registerMutation]);

  return { ensurePermissionAndRegister, registerIfAlreadyGranted, registerMutation, unregisterMutation };
}
