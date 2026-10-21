/**
 * Prominent Profile row linking to /inbox ("Meetups & messages") with the
 * combined needs-attention count. Shares query keys with the tab-bar badge.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, MessagesSquare } from 'lucide-react-native';
import { Text } from '../ui/Text';
import { trpc } from '@/lib/trpc';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';

export function InboxLinkRow() {
  const router = useRouter();
  const unread = trpc.conversation.unreadTotal.useQuery(undefined, { refetchInterval: 15_000 });
  const offers = trpc.offer.mine.useQuery({ role: 'seller' }, { refetchInterval: 15_000 });
  const pendingOffers = (offers.data ?? []).filter((o) => o.status === 'pending').length;
  const total = (unread.data?.conversations ?? 0) + (unread.data?.actionableReservations ?? 0) + pendingOffers;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={total > 0 ? `Meetups and messages, ${total} need attention` : 'Meetups and messages'}
      onPress={() => router.push('/inbox')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <MessagesSquare size={22} color={colors.accent} />
      <View style={styles.text}>
        <Text variant="heading">Meetups & messages</Text>
        <Text variant="caption" color="inkMuted">
          Meetups, offers, and chats with buyers and sellers
        </Text>
      </View>
      {total > 0 ? (
        <View style={styles.badge}>
          <Text variant="caption" weight="600" color="white">
            {total > 9 ? '9+' : total}
          </Text>
        </View>
      ) : null}
      <ChevronRight size={20} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: minTouchHeight + 8,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.85 },
  text: { flex: 1, gap: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default InboxLinkRow;
