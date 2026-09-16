/**
 * Root layout: gesture handler root, safe-area provider, React Query + tRPC
 * providers, auth provider, and the root Stack (tabs + modal routes).
 */
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { trpc, trpcClient } from '@/lib/trpc';
import { AuthProvider } from '@/components/AuthProvider';
import { colors } from '@/constants/theme';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { NotificationPermissionGate } from '@/components/notifications/NotificationPermissionGate';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },
});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <AuthProvider>
              <StatusBar style="dark" />
              <ConnectionBanner />
              <NotificationPermissionGate />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.bg },
                  headerTintColor: colors.ink,
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="listing/[id]" options={{ title: '' }} />
                <Stack.Screen
                  name="listing/new"
                  options={{ presentation: 'modal', title: 'New listing' }}
                />
                <Stack.Screen name="listing/[id]/edit" options={{ presentation: 'modal', title: 'Edit listing' }} />
                <Stack.Screen
                  name="reservation/request"
                  options={{ presentation: 'modal', title: 'Request meetup' }}
                />
                <Stack.Screen name="reservation/[id]" options={{ title: 'Meetup' }} />
                <Stack.Screen name="conversation/[id]" options={{ title: 'Conversation' }} />
                <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
                <Stack.Screen name="moderation" options={{ title: 'Moderation' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="payments/[reservationId]" options={{ title: 'Payment' }} />
                <Stack.Screen name="legal/terms" options={{ title: 'Terms of Service' }} />
                <Stack.Screen name="legal/privacy" options={{ title: 'Privacy Policy' }} />
                <Stack.Screen
                  name="auth/sign-in"
                  options={{ presentation: 'modal', title: 'Sign in' }}
                />
                <Stack.Screen
                  name="auth/verify"
                  options={{ presentation: 'modal', title: 'Verify code' }}
                />
                <Stack.Screen name="+not-found" />
              </Stack>
            </AuthProvider>
          </trpc.Provider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
