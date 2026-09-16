/**
 * Non-blocking banner shown under the safe-area top when the app can't
 * reach the backend. Mount once near the root (see app/_layout.tsx) — it
 * renders nothing while online or still checking, so it never covers the
 * tab bar or blocks taps.
 *
 * Usage: <ConnectionBanner />
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCw } from 'lucide-react-native';
import { Text } from './Text';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { useConnection } from '@/hooks/useConnection';

export function ConnectionBanner() {
  const { status, apiBaseUrl, retry } = useConnection();
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = status === 'offline';
  const queryClient = useQueryClient();
  const wasOffline = useRef(false);

  // When the server comes back, every query that was in flight or had failed
  // needs to start over. resetQueries() is the blunt instrument that actually
  // works here: refetchQueries() skips queries with no successful data yet, and
  // onlineManager's pause/resume left them stuck in 'pending'. Resetting clears
  // their state and refetches everything currently on screen.
  useEffect(() => {
    if (status === 'offline') {
      wasOffline.current = true;
    } else if (status === 'online' && wasOffline.current) {
      wasOffline.current = false;
      void queryClient.resetQueries();
    }
  }, [status, queryClient]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start();
  }, [visible, reduceMotion, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top, opacity }]}
      pointerEvents="box-none"
    >
      <View
        style={styles.card}
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Can't reach the server. Trying ${apiBaseUrl}.`}
      >
        <View style={styles.headerRow}>
          <AlertTriangle size={16} color={colors.warning} />
          <Text variant="label" color="warning" style={styles.title}>
            Can&apos;t reach the server
          </Text>
        </View>
        <Text variant="caption" color="inkMuted" style={styles.url} numberOfLines={1}>
          Trying {apiBaseUrl}
        </Text>
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          Make sure your phone is on the same Wi-Fi as your Mac, the backend is running
          (npm run backend), and re-run npm run env:lan if the Mac&apos;s IP changed.
        </Text>
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Retry connecting to the server"
          hitSlop={8}
          style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed]}
        >
          <RotateCw size={14} color={colors.warning} />
          <Text variant="label" color="warning" style={styles.retryText}>
            Retry
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  card: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: space.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  title: { flexShrink: 1 },
  url: { marginTop: 2 },
  hint: { marginTop: space.xs, lineHeight: 16 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.sm,
    minHeight: minTouchHeight,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  retryBtnPressed: { opacity: 0.6 },
  retryText: {},
});

export default ConnectionBanner;
