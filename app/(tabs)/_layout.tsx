/**
 * Bottom tabs: Browse · Sell · Community · Profile. Sell doesn't render its own
 * screen — pressing it opens /listing/new as a modal instead (intercepted via
 * the tabPress listener below); app/(tabs)/sell.tsx is a trivial redirect
 * kept only so the route exists for typed-routes/deep-links.
 *
 * The Profile tab carries a badge = unread conversations + actionable
 * reservations + pending offers received (capped at "9+" for display), polled
 * every ~15s while signed in (never while signed out). Messaging lives at
 * /inbox ("Meetups & messages"), linked from Profile and Community.
 */
import React from 'react';
import { Platform, StyleSheet, Text as RNText, View, useWindowDimensions } from 'react-native';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { Search, PlusCircle, Users, User } from 'lucide-react-native';
import { colors, breakpoints, maxContentWidth } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';

const UNREAD_POLL_MS = 15_000;

export default function TabsLayout() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoints.lg;

  const unreadTotalQuery = trpc.conversation.unreadTotal.useQuery(undefined, {
    refetchInterval: signedIn ? UNREAD_POLL_MS : false,
    enabled: signedIn,
  });

  const pendingOffersQuery = trpc.offer.mine.useQuery(
    { role: 'seller' },
    { refetchInterval: signedIn ? UNREAD_POLL_MS : false, enabled: signedIn },
  );
  const pendingOffers = signedIn
    ? (pendingOffersQuery.data ?? []).filter((o) => o.status === 'pending').length
    : 0;

  const total = signedIn
    ? (unreadTotalQuery.data?.conversations ?? 0) +
      (unreadTotalQuery.data?.actionableReservations ?? 0) +
      pendingOffers
    : 0;

  // On the website the front door is the create-account / log-in page, so a
  // signed-out visitor to trydibbs.com lands there rather than in the feed.
  // Shared links to a single listing (/listing/…) stay public — they live
  // outside this tab group. The native app keeps signed-out browsing.
  if (Platform.OS === 'web' && status === 'signedOut') return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        // On desktop the bar is capped to the content column's width so it
        // lines up with the grid above it. It stays a bottom bar — turning it
        // into a sidebar is a design decision nobody has made.
        //
        // Centred with `marginHorizontal: 'auto'`, NOT `alignSelf`. React
        // Navigation positions the tab bar absolutely with left and right
        // pinned, and CSS ignores `align-self` on an absolutely-positioned
        // element — so alignSelf did nothing and the bar stayed full width.
        // Auto horizontal margins against a maxWidth DO centre a positioned
        // element that has both left and right set, which is the case here.
        tabBarStyle: isDesktop
          ? {
              backgroundColor: colors.surface,
              borderTopColor: colors.line,
              maxWidth: maxContentWidth,
              marginHorizontal: 'auto',
            }
          : { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sell"
        options={{
          title: 'Sell',
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/listing/new');
          },
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <View>
              <User color={color} size={size} />
              {total > 0 ? (
                <View style={styles.badge}>
                  <RNText style={styles.badgeText}>{total > 9 ? '9+' : total}</RNText>
                </View>
              ) : null}
            </View>
          ),
          tabBarAccessibilityLabel:
            total > 0 ? `Profile, ${total} item${total === 1 ? '' : 's'} need attention` : 'Profile',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
});
