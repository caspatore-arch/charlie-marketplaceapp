/**
 * Shows a server error verbatim (accessible alert). When the server refused
 * because the account has no verified campus email, also offers a link to
 * Settings where "Verify campus email" lives.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';

export interface ServerErrorLike {
  message: string;
  data?: { code?: string } | null;
}

export function isCampusVerifyError(err: ServerErrorLike | null | undefined): boolean {
  return !!err && err.data?.code === 'FORBIDDEN' && /campus email/i.test(err.message);
}

export function ServerErrorNote({ error, onDismiss }: { error: ServerErrorLike | null; onDismiss?: () => void }) {
  const router = useRouter();
  if (!error) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text variant="body" color="danger">
        {error.message}
      </Text>
      {isCampusVerifyError(error) ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Settings to verify your campus email"
          onPress={() => {
            onDismiss?.();
            router.push('/settings');
          }}
          style={styles.link}
        >
          <Text variant="label" color="accent" weight="600">
            Verify campus email in Settings
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: space.md, gap: space.xs },
  link: { minHeight: minTouchHeight, justifyContent: 'center' },
});
