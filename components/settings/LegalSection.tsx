/**
 * Links to the placeholder Terms of Service and Privacy Policy documents
 * (app/legal/terms.tsx, app/legal/privacy.tsx). Kept as its own section
 * next to "About this prototype" rather than folded into it, so the legal
 * documents are easy to find and easy to swap out later.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { space } from '@/constants/theme';

export function LegalSection() {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <Text variant="label" color="inkMuted" style={styles.subheading}>
        Legal
      </Text>
      <Text variant="body" color="inkMuted" style={styles.note}>
        Draft placeholders — not reviewed by a lawyer yet.
      </Text>
      <Button
        title="Terms of Service"
        variant="secondary"
        onPress={() => router.push('/legal/terms')}
        style={styles.button}
        accessibilityLabel="View Terms of Service"
      />
      <Button
        title="Privacy Policy"
        variant="secondary"
        onPress={() => router.push('/legal/privacy')}
        style={styles.button}
        accessibilityLabel="View Privacy Policy"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  subheading: { marginTop: space.lg },
  note: { marginBottom: space.xs },
  button: { alignSelf: 'flex-start' },
});

export default LegalSection;
