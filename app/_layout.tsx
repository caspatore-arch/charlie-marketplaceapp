/**
 * Root layout: gesture handler root, safe-area provider, React Query + tRPC
 * providers, auth provider, and the root Stack (tabs + modal routes).
 */
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
// Per-weight subpath imports: the package root re-exports all 18 faces and
// would put every one of them in the web export.
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_500Medium } from '@expo-google-fonts/montserrat/500Medium';
import { Montserrat_600SemiBold } from '@expo-google-fonts/montserrat/600SemiBold';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
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
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });
  const fontsSettled = fontsLoaded || !!fontError;

  // Hide the splash once fonts load OR fail: a font error must never trap
  // users on the splash. On error the app renders in the system font.
  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => {});
  }, [fontsSettled]);

  if (!fontsSettled) return null;

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
                {/* `title` is what the browser tab says on the web build —
                    expo-router maps it to document.title. The tabs screen
                    hides its header but still needs the title, or the web
                    MVP opens in a tab labelled "index". */}
                <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Dibbs' }} />
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
                <Stack.Screen name="inbox" options={{ title: 'Meetups & messages' }} />
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
