/**
 * Bottom sheet built on RN's Modal (no external sheet library, per repo constraints).
 * Usage: <Sheet visible={open} onClose={() => setOpen(false)} title="Pick a time">{...}</Sheet>
 */
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
      />
      {/* RN's Modal renders in its own native window, so the screen's own
          KeyboardAvoidingView (if any) never sees it — every sheet with a
          text field (ReportSheet, PriceFilterSheet, WindowEditor's add-window
          sheet, ModerationActionSheet, the reservation propose/cancel/report
          sheets) needs its own avoidance or the keyboard covers the input. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.handle} />
          {title ? (
            <Text variant="heading" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Absolute-fill so the avoider spans the full window: `maxHeight: '85%'` on
  // the sheet is then relative to the window, not to a content-sized parent
  // (which on web clipped the sheet and let its content spill out the bottom).
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22,21,19,0.4)',
  },
  avoider: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    marginVertical: space.sm,
  },
  title: { marginBottom: space.md },
});

export default Sheet;
