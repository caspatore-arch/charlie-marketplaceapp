/**
 * "Email your video" (free, optional), shown only in the post-publish modal.
 *
 * A single button that opens the person's own mail app with a prefilled message
 * (subject = listing title, body = the listing link and a reminder to attach the
 * video). There is no upload, no network call and no automatic publishing: the
 * founder may feature a video on the Dibbs Instagram, and a feature is not
 * guaranteed. The address is also printed so it can be used without a mail app.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { VIDEO_SUBMISSION_EMAIL } from '@/constants/contact';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { openIntent } from './ShareRow';

interface Props {
  title: string;
  /** The listing link, from `listingShareUrl(id)`. */
  url: string;
}

export function videoMailtoUrl({ title, url }: Props): string {
  const enc = encodeURIComponent;
  return `mailto:${VIDEO_SUBMISSION_EMAIL}?subject=${enc(title)}&body=${enc(`${url}\n\nAttach your video to this email.`)}`;
}

export function VideoEmailSection({ title, url }: Props) {
  const [status, setStatus] = useState<string | null>(null);

  async function open() {
    const ok = await openIntent(videoMailtoUrl({ title, url }));
    setStatus(ok ? null : `Couldn't open a mail app. Email your video to ${VIDEO_SUBMISSION_EMAIL} yourself.`);
  }

  return (
    <View style={styles.box}>
      <Text variant="heading">Email your video</Text>
      <Text variant="caption" color="inkMuted">
        Optional and free
      </Text>
      <Text variant="label" color="inkMuted">
        Send us a short video of your item. The Dibbs founder may feature it on the Dibbs Instagram. A feature is not
        guaranteed.
      </Text>
      <Button title="Email your video" variant="secondary" onPress={open} />
      <Text variant="caption" color="inkMuted">
        Or email{' '}
        <Text selectable variant="caption" color="accentInk">
          {VIDEO_SUBMISSION_EMAIL}
        </Text>{' '}
        yourself. This opens your mail app; nothing is sent until you send it.
      </Text>
      <Text
        variant="caption"
        color="danger"
        accessibilityLiveRegion="polite"
        {...(Platform.OS === 'web' ? ({ role: 'status' } as object) : {})}
      >
        {status ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
