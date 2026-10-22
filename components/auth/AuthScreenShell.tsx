/**
 * Shared chrome for the auth routes: heading, and the flow
 * itself in a card.
 *
 * It exists so /auth/sign-in and /auth/email cannot drift apart. Both used to
 * render a bare form directly onto the page background, which on a desktop
 * browser stretched a single email field across the full content column and
 * read as an unfinished page rather than a sign-in.
 *
 * The card is capped well below the Screen's own desktop max width: a form is
 * a column of single-line inputs, and a 860px-wide text field looks broken no
 * matter how correct the layout maths are.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { breakpoints, colors, radius, shadow, space } from '@/constants/theme';

/** A sign-in form reads as a column; past this it stops looking like one. */
const FORM_MAX_WIDTH = 440;

export interface AuthScreenShellProps {
  title: string;
  children: React.ReactNode;
}

export function AuthScreenShell({ title, children }: AuthScreenShellProps) {
  const { width } = useWindowDimensions();
  const roomToBreathe = width >= breakpoints.md;

  return (
    <Screen scroll>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={[styles.column, { maxWidth: FORM_MAX_WIDTH }]}>
          <Text variant={roomToBreathe ? 'display' : 'title'} accessibilityRole="header">
            {title}
          </Text>

          <View style={styles.card}>{children}</View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingTop: space.xl, paddingBottom: space.huge },
  // alignSelf rather than margin:auto so the column stays left-aligned with
  // the logo on a phone and simply stops growing on a wide screen.
  column: { width: '100%', gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
    ...shadow,
  },
});

export default AuthScreenShell;
