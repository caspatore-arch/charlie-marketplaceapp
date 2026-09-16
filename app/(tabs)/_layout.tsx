/**
 * Bottom tabs: Browse · Sell · Inbox · Profile. Sell doesn't render its own
 * screen — pressing it opens /listing/new as a modal instead (intercepted via
 * the tabPress listener below); app/(tabs)/sell.tsx is a trivial redirect
 * kept only so the route exists for typed-routes/deep-links.
 *
 * The Inbox tab carries a badge = unread conversations + actionable
 * reservations (capped at "9+" for display), backed by conversation.unreadTotal
 * polled every ~15s while signed in (never while signed out).
 */
import React from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Search, PlusCircle, MessageCircle, User } from 'lucide-react-native';
import { colors } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';

const UNREAD_POLL_MS = 15_000;

export default function TabsLayout() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  const unreadTotalQuery = trpc.conversation.unreadTotal.useQuery(undefined, {
    refetchInterval: signedIn ? UNREAD_POLL_MS : false,
    enabled: signedIn,
  });

  const total = signedIn
    ? (unreadTotalQuery.data?.conversations ?? 0) + (unreadTotalQuery.data?.actionableReservations ?? 0)
    : 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
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
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => (
            <View>
              <MessageCircle color={color} size={size} />
              {total > 0 ? (
                <View style={styles.badge}>
                  <RNText style={styles.badgeText}>{total > 9 ? '9+' : total}</RNText>
                </View>
              ) : null}
            </View>
          ),
          tabBarAccessibilityLabel:
            total > 0 ? `Inbox, ${total} item${total === 1 ? '' : 's'} need attention` : 'Inbox',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
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
