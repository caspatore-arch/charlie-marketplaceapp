/**
 * Plain, honest disclosure of prototype limitations. Copy matches
 * docs/DESIGN.md's rules (never imply payment protection, "simulated" not
 * "protected"). App version comes from expo-constants when available.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { Text } from '@/components/ui/Text';
import { space } from '@/constants/theme';

const NOTES = [
  'Payments are simulated. No real money moves — the fee breakdown you see is for demonstration only.',
  'Sign-in codes are printed to the server log in this prototype, not emailed to you.',
  'Demo listings and meetup spots are labeled "Demo" and their locations are unverified — check hours and permission yourself before relying on them.',
];

export function AboutPrototypeSection() {
  const version = Constants.expoConfig?.version;

  return (
    <View style={styles.wrap}>
      {NOTES.map((note) => (
        <View key={note} style={styles.row}>
          <Text variant="body" color="inkMuted" style={styles.bullet}>
            •
          </Text>
          <Text variant="body" color="inkMuted" style={styles.noteText}>
            {note}
          </Text>
        </View>
      ))}
      {version ? (
        <Text variant="caption" color="inkFaint" style={styles.version}>
          App version {version}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { flexDirection: 'row', gap: space.sm },
  bullet: { lineHeight: 21 },
  noteText: { flex: 1, lineHeight: 21 },
  version: { marginTop: space.sm },
});

export default AboutPrototypeSection;
