/**
 * Settings screen, grouped: Profile (name, bio, campus), Verification (phone
 * verified, campus email verified; neither is an ID check), Contact sharing,
 * Notifications (push + text), Safety (blocked users), About & legal, then
 * Sign out and Close account separated at the bottom. Payouts stays hidden
 * while payments are off. Signed-in only; signed-out shows a sign-in CTA.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { AccountSection } from '@/components/settings/AccountSection';
import { PhoneAccountSection } from '@/components/settings/PhoneAccountSection';
import { SafetySection } from '@/components/settings/SafetySection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { PayoutsSection } from '@/components/settings/PayoutsSection';
import { usePaymentsEnabled } from '@/hooks/usePaymentsEnabled';
import { AboutPrototypeSection } from '@/components/settings/AboutPrototypeSection';
import { LegalSection } from '@/components/settings/LegalSection';
import { CloseAccountSection } from '@/components/settings/CloseAccountSection';
import { ContactSharingSection } from '@/components/profile/ContactSharingSection';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useAuth } from '@/hooks/useAuth';
import { colors, space } from '@/constants/theme';

export default function SettingsScreen() {
  const { status, signOut } = useAuth();
  const router = useRouter();
  const paymentsEnabled = usePaymentsEnabled();

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
        <SettingsSection title="Profile">
          <AccountSection />
        </SettingsSection>

        <SettingsSection title="Verification">
          <PhoneAccountSection part="verification" />
        </SettingsSection>

        <SettingsSection title="Contact sharing">
          <ContactSharingSection />
        </SettingsSection>

        {paymentsEnabled ? (
          <SettingsSection title="Payouts">
            <PayoutsSection />
          </SettingsSection>
        ) : null}

        <SettingsSection title="Notifications">
          <NotificationsSection />
          <PhoneAccountSection part="texts" />
        </SettingsSection>

        <SettingsSection title="Safety">
          <SafetySection />
        </SettingsSection>

        <SettingsSection title="About & legal" hideDivider>
          <AboutPrototypeSection />
          <LegalSection />
        </SettingsSection>

        <View style={styles.bottom}>
          <Button
            title="Sign out"
            variant="secondary"
            onPress={signOut}
            accessibilityLabel="Sign out"
          />
          <View style={styles.danger}>
            <SettingsSection title="Close account" hideDivider>
              <CloseAccountSection />
            </SettingsSection>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingBottom: space.huge },
  loadingWrap: { gap: space.md, paddingTop: space.xl },
  bottom: {
    marginTop: space.section,
    paddingTop: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  danger: { marginTop: space.section },
});
