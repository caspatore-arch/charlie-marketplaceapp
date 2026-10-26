/**
 * Profile row: "Send us recommendations". Opens the person's own mail app with
 * a short template addressed to the founder inbox. Nothing is sent or stored by
 * the App; the person edits and sends it themselves. The address is shown if no
 * mail app opens.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight, Lightbulb } from 'lucide-react-native';
import { Text } from '../ui/Text';
import { openIntent } from '@/components/share/ShareRow';
import { OPERATOR_CONTACT_EMAIL } from '@/constants/legal';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';

const SUBJECT = 'Dibbs recommendation';
const BODY = [
  'What could Dibbs do better?',
  '',
  '',
  'What were you trying to do when you thought of it?',
  '',
  '',
  'Anything that got in your way or confused you?',
  '',
  '',
  '(Optional) Can we follow up with you about this? Yes / No',
  '',
  'Sent from my Dibbs profile',
].join('\n');

export function recommendationsMailtoUrl(): string {
  const enc = encodeURIComponent;
  return `mailto:${OPERATOR_CONTACT_EMAIL}?subject=${enc(SUBJECT)}&body=${enc(BODY)}`;
}

export function RecommendationsRow() {
  const [status, setStatus] = useState<string | null>(null);

  async function open() {
    const ok = await openIntent(recommendationsMailtoUrl());
    setStatus(ok ? null : `Couldn't open a mail app. Email your ideas to ${OPERATOR_CONTACT_EMAIL}.`);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send us recommendations. Opens an email to the Dibbs team."
        onPress={open}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Lightbulb size={22} color={colors.accent} />
        <View style={styles.text}>
          <Text variant="heading">Send us recommendations</Text>
          <Text variant="caption" color="inkMuted">
            Tell us what Dibbs could do better. Opens an email you can edit before sending.
          </Text>
        </View>
        <ChevronRight size={20} color={colors.inkFaint} />
      </Pressable>
      <Text
        variant="caption"
        color="danger"
        accessibilityLiveRegion="polite"
        {...(Platform.OS === 'web' ? ({ role: 'status' } as object) : {})}
      >
        {status ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.md },
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
});
