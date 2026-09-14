/**
 * Full-screen container: safe-area padding + themed background.
 * Usage: <Screen><YourContent /></Screen>
 * Pass `scroll` to wrap children in a ScrollView, `padded={false}` to skip
 * the default horizontal padding (e.g. for edge-to-edge photo grids).
 */
import React from 'react';
import { StyleSheet, View, ScrollView, type ViewStyle, type ScrollViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space } from '@/constants/theme';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  backgroundColor?: string;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
  contentContainerStyle,
  backgroundColor = colors.bg,
}: ScreenProps) {
  const content = padded ? styles.padded : null;

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor }, style]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[content, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: space.lg },
});

export default Screen;
