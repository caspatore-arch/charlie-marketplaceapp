/**
 * What Browse shows when the live feed is empty (no search, no filters, not
 * the Archive). An empty feed is the moment to turn a buyer into a seller, so
 * it offers the two ways to sell, with the Dibbs offer first: send photos to
 * the Dibbs team, or list it on the marketplace. The Archive link stays, since
 * older listings can still be bought there.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Send, Tag } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { TextLink } from '@/components/ui/TextLink';
import { colors, radius, space } from '@/constants/theme';

export function EmptyFeedSell({ onSeeArchive }: { onSeeArchive: () => void }) {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <Text variant="title" accessibilityRole="header" style={styles.center}>
        Sell your stuff
      </Text>
      <Text variant="body" color="inkMuted" style={styles.center}>
        Nothing new on campus in the last 24 hours. Be the first: two ways to sell.
      </Text>

      <Card
        onPress={() => router.push('/dibbs-offer/new')}
        style={[styles.choice, styles.choiceFirst]}
        accessibilityLabel="Get a Dibbs offer. Send a photo to the Dibbs team and get an offer, within an hour during team hours. Nothing is posted publicly."
      >
        <View style={styles.icon}>
          <Send size={22} color={colors.accentInk} />
        </View>
        <View style={styles.text}>
          <Text variant="heading">Get a Dibbs offer</Text>
          <Text variant="bodySm" color="inkMuted">
            Send a photo to the Dibbs team and get an offer, within an hour during team hours. Nothing is posted
            publicly.
          </Text>
        </View>
        <ChevronRight size={20} color={colors.inkFaint} />
      </Card>

      <Card
        onPress={() => router.push('/listing/new?mode=list')}
        style={styles.choice}
        accessibilityLabel="Put it on the marketplace. Set your price and post it for everyone on campus for 24 hours."
      >
        <View style={styles.icon}>
          <Tag size={22} color={colors.accentInk} />
        </View>
        <View style={styles.text}>
          <Text variant="heading">Put it on the marketplace</Text>
          <Text variant="bodySm" color="inkMuted">
            Set your price and post it for everyone on campus for 24 hours. You meet the buyer yourself.
          </Text>
        </View>
        <ChevronRight size={20} color={colors.inkFaint} />
      </Card>

      <TextLink align="center" variant="small" onPress={onSeeArchive}>
        Or browse the Archive: older listings you can still buy
      </TextLink>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: space.md, paddingVertical: space.xxxl },
  center: { textAlign: 'center' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  choiceFirst: { marginTop: space.md, borderColor: colors.accent, borderWidth: 2 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});

export default EmptyFeedSell;
