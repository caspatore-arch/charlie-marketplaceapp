/**
 * Safety section: blocked-users management plus a short, factual note on
 * what reporting actually does (no over-promising — see docs/DESIGN.md
 * "Rules of copy").
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { BlockedUsersList } from './BlockedUsersList';
import { space } from '@/constants/theme';

export function SafetySection() {
  return (
    <View style={styles.wrap}>
      <View>
        <Text variant="label" color="inkMuted" style={styles.subheading}>
          Blocked users
        </Text>
        <BlockedUsersList />
      </View>

      <Text variant="body" color="inkMuted" style={styles.reportingNote}>
        When you report a listing or a person, it goes to a campus operator who reviews it. This is not a
        background check and not law enforcement — for anything urgent or unsafe, contact campus police or 911.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  subheading: { marginBottom: space.sm },
  reportingNote: { lineHeight: 21 },
});

export default SafetySection;
