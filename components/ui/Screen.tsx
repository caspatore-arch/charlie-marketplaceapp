/**
 * Full-screen container: safe-area padding + themed background.
 * Usage: <Screen><YourContent /></Screen>
 * Pass `scroll` to wrap children in a ScrollView, `padded={false}` to skip
 * the default horizontal padding (e.g. for edge-to-edge photo grids).
 *
 * On desktop (width >= breakpoints.lg) the inner content is centred and
 * capped at maxContentWidth so the phone-shaped UI doesn't stretch across
 * a 1440px monitor. On mobile the rendered output is byte-for-byte
 * equivalent to the previous single-view implementation — no extra wrapper,
 * no changed flex chain, no added safe-area edge.
 */
import React from 'react';
import { StyleSheet, View, ScrollView, useWindowDimensions, type ViewStyle, type ScrollViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space, breakpoints, maxContentWidth } from '@/constants/theme';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  backgroundColor?: string;
  /** Desktop content cap in px. Defaults to `maxContentWidth`; a screen with a multi-column grid (Browse) can ask for more. */
  maxWidth?: number;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
  contentContainerStyle,
  backgroundColor = colors.bg,
  maxWidth = maxContentWidth,
}: ScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoints.lg;

  const paddingStyle = padded ? styles.padded : null;

  // On desktop: wrap content in a centred column so the phone UI doesn't
  // stretch to the viewport edges. The outer SafeAreaView keeps the
  // background colour filling the full viewport; the inner centred View
  // caps the content. flex:1 is preserved on every node so the
  // SafeAreaView → ScrollView (or View) → centredColumn chain all expand
  // to fill the screen height, keeping scroll working correctly.
  const centredColumn: ViewStyle | null = isDesktop
    ? {
        width: '100%',
        maxWidth,
        alignSelf: 'center',
        flex: 1,
      }
    : null;

  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor }, style]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            paddingStyle,
            // On desktop, constrain the scrollable content column.
            // We use alignItems + minWidth so the content column itself
            // is centred, while the ScrollView background fills full width.
            isDesktop ? styles.scrollDesktop : null,
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {isDesktop ? (
            <View style={centredColumn!}>{children}</View>
          ) : (
            children
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor }, style]}>
      {isDesktop ? (
        <View style={[styles.flex, paddingStyle, centredColumn!]}>{children}</View>
      ) : (
        <View style={[styles.flex, paddingStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: space.lg },
  // On desktop, the ScrollView's contentContainer becomes a full-width
  // column-flex with alignItems:center so the inner centredColumn View
  // centres itself. flexGrow:1 keeps it filling the viewport height.
  scrollDesktop: {
    flexGrow: 1,
    alignItems: 'center' as const,
  },
});

export default Screen;
