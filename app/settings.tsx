/**
 * Settings screen: Account (editable display name/bio, read-only campus +
 * verification), Safety (blocked users + what reporting does), About this
 * prototype (honest disclosures), Close account (destructive, typed
 * confirmation), and Sign out. Signed-in only — signed-out shows a sign-in
 * CTA, matching the Profile screen's convention.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { AccountSection } from '@/components/settings/AccountSection';
import { SafetySection } from '@/components/settings/SafetySection';
import { AboutPrototypeSection } from '@/components/settings/AboutPrototypeSection';
import { LegalSection } from '@/components/settings/LegalSection';
import { CloseAccountSection } from '@/components/settings/CloseAccountSection';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useAuth } from '@/hooks/useAuth';
import { space } from '@/constants/theme';

export default function SettingsScreen() {
  const { status, signOut } = useAuth();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Settings' }} />
        <View style={styles.loadingWrap}>
          <Skeleton height={48} />
          <Skeleton height={100} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  if (status === 'signedOut') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Settings' }} />
        <EmptyState
          title="Sign in to see settings"
          body="Your account details, safety tools, and account closure live here once you're signed in."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Settings' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <SettingsSection title="Account">
          <AccountSection />
        </SettingsSection>

        <SettingsSection title="Safety">
          <SafetySection />
        </SettingsSection>

        <SettingsSection title="About this prototype">
          <AboutPrototypeSection />
        </SettingsSection>

        <SettingsSection title="Legal">
          <LegalSection />
        </SettingsSection>

        <Button
          title="Sign out"
          variant="ghost"
          onPress={signOut}
          style={styles.signOut}
          accessibilityLabel="Sign out"
        />

        <SettingsSection title="Close account" hideDivider>
          <CloseAccountSection />
        </SettingsSection>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingBottom: space.huge },
  loadingWrap: { gap: space.md, paddingTop: space.xl },
  signOut: { marginTop: space.lg },
});
