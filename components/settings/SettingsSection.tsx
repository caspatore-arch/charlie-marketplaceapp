/**
 * Section wrapper for the Settings screen: title + content + trailing
 * divider, matching the `Section` pattern used on the Profile screen.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Divider } from '@/components/ui/Divider';
import { colors, space } from '@/constants/theme';

export interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
  /** Render without the trailing divider, e.g. for the last section. */
  hideDivider?: boolean;
}

export function SettingsSection({ title, children, hideDivider }: SettingsSectionProps) {
  return (
    <View style={styles.section}>
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      {children}
      {hideDivider ? null : <Divider style={styles.divider} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xl },
  title: { marginBottom: space.md },
  divider: { marginTop: space.xl, backgroundColor: colors.line },
});

export default SettingsSection;
