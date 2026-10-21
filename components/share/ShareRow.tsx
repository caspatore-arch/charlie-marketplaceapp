/**
 * Share targets for a freshly posted listing.
 *
 * Real prefilled intents: X, Facebook, WhatsApp, Reddit, Telegram, SMS, Email.
 * Instagram and Snapchat have no web share intent, so they never pretend to:
 * they open the OS share sheet where one exists (the user picks the app), and
 * otherwise copy the link so it can be pasted there. Every action reports what
 * happened in a visible, announced status line.
 */
import React, { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { canUseShareSheet, copyTextToClipboard, openShareSheet } from '@/utils/shareListing';
import { buildIntentUrl, type IntentTarget, type ShareContent } from './shareIntents';

const INTENTS: { target: IntentTarget; label: string }[] = [
  { target: 'whatsapp', label: 'WhatsApp' },
  { target: 'sms', label: 'Text message' },
  { target: 'x', label: 'X' },
  { target: 'facebook', label: 'Facebook' },
  { target: 'reddit', label: 'Reddit' },
  { target: 'telegram', label: 'Telegram' },
  { target: 'email', label: 'Email' },
];

function openIntent(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (url.startsWith('http')) {
      // New tab so the app stays where it is.
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      // sms:/mailto: hand off to the OS app; they do not replace the page.
      window.location.href = url;
    }
    return;
  }
  Linking.openURL(url).catch(() => {});
}

function Chip({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
    >
      <Text variant="label" weight="600">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="inkMuted">
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function ShareRow({ content }: { content: ShareContent }) {
  const [status, setStatus] = useState<string | null>(null);
  const sheet = canUseShareSheet();

  async function viaSheetOrCopy(app?: string) {
    if (sheet) {
      const r = await openShareSheet({ title: content.title, text: content.text, url: content.url });
      if (r === 'failed') setStatus('Could not open the share sheet. Try Copy link.');
      else if (r === 'shared') setStatus(app ? `Shared. Pick ${app} in the share sheet next time too.` : 'Shared.');
      else setStatus(null);
      return;
    }
    await copyLink(app);
  }

  async function copyLink(app?: string) {
    const ok = await copyTextToClipboard(content.url);
    if (!ok) setStatus(`Could not copy automatically. Link: ${content.url}`);
    else setStatus(app ? `Link copied. Paste it into ${app}.` : 'Link copied.');
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {INTENTS.map(({ target, label }) => (
          <Chip key={target} label={label} onPress={() => openIntent(buildIntentUrl(target, content))} />
        ))}
        <Chip
          label="Instagram"
          hint={sheet ? 'Opens share sheet' : 'Copies link to paste'}
          onPress={() => viaSheetOrCopy('Instagram')}
        />
        <Chip
          label="Snapchat"
          hint={sheet ? 'Opens share sheet' : 'Copies link to paste'}
          onPress={() => viaSheetOrCopy('Snapchat')}
        />
        {Platform.OS === 'web' ? (
          <Chip label="Copy link" onPress={() => copyLink()} />
        ) : (
          <Chip label="More options" hint="Share sheet, including Copy" onPress={() => viaSheetOrCopy()} />
        )}
      </View>
      <Text
        variant="caption"
        color="inkMuted"
        style={styles.status}
        accessibilityLiveRegion="polite"
        {...(Platform.OS === 'web' ? ({ role: 'status' } as object) : {})}
      >
        {status ?? ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: minTouchHeight,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipPressed: { backgroundColor: colors.surfaceMuted },
  status: { minHeight: 16 },
});
