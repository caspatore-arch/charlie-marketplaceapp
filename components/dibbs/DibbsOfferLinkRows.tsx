/**
 * Profile rows: "Dibbs offer requests" (every signed-in seller) and, only when
 * the server says the account is on the Dibbs buying team, "Dibbs offer queue
 * (staff)". Same look as the Saved row.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ChevronRight, ClipboardList, Send } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import { trpc } from '@/lib/trpc';

function LinkRow({
  icon,
  title,
  subtitle,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {icon}
      <View style={styles.text}>
        <Text variant="heading">{title}</Text>
        <Text variant="caption" color="inkMuted">
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.inkFaint} />
    </Pressable>
  );
}

export function DibbsOfferLinkRows() {
  const router = useRouter();
  const staff = trpc.dibbsStaff.amI.useQuery();
  return (
    <View>
      <LinkRow
        icon={<Send size={22} color={colors.accent} />}
        title="Dibbs offer requests"
        subtitle="Private requests you sent to the Dibbs team"
        label="Dibbs offer requests, open your private requests to the Dibbs team"
        onPress={() => router.push('/dibbs-offer')}
      />
      {staff.data?.isStaff ? (
        <LinkRow
          icon={<ClipboardList size={22} color={colors.accent} />}
          title="Dibbs offer queue (staff)"
          subtitle="Requests waiting for the buying team"
          label="Dibbs offer queue, staff only"
          onPress={() => router.push('/staff/dibbs-offers' as Href)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: minTouchHeight + 8,
    padding: space.lg,
    marginBottom: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.85 },
  text: { flex: 1, gap: 2 },
});

export default DibbsOfferLinkRows;
