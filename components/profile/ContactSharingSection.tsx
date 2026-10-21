/**
 * Opt-in contact sharing, shown in Settings next to the rest of profile
 * editing. A student may add an Instagram handle and a phone number and then
 * choose, per field, whether other students can see it. Both are optional and
 * both start OFF. Sharing is enforced on the server (toPublicUser) — this
 * screen only edits the values and the opt-ins.
 *
 * The phone number here is just a number the student typed. It is NOT their
 * sign-in number and is never verified.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';

function ShareSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.switchRow}
    >
      <View style={styles.switchText}>
        <Text variant="body">{label}</Text>
        <Text variant="caption" color="inkMuted">
          {hint}
        </Text>
      </View>
      <View style={[styles.track, checked ? styles.trackOn : null]}>
        <View style={[styles.thumb, checked ? styles.thumbOn : null]} />
      </View>
    </Pressable>
  );
}

export function ContactSharingSection() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery();

  const [instagram, setInstagram] = useState('');
  const [phone, setPhone] = useState('');
  const [shareInstagram, setShareInstagram] = useState(false);
  const [sharePhone, setSharePhone] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (meQuery.data && !dirty) {
      setInstagram(meQuery.data.instagramHandle ?? '');
      setPhone(meQuery.data.contactPhone ?? '');
      setShareInstagram(meQuery.data.shareInstagram);
      setSharePhone(meQuery.data.sharePhone);
    }
  }, [meQuery.data, dirty]);

  const mutation = trpc.user.updateMe.useMutation({
    onSuccess: async (updated) => {
      setDirty(false);
      setInstagram(updated.instagramHandle ?? '');
      setPhone(updated.contactPhone ?? '');
      setShareInstagram(updated.shareInstagram);
      setSharePhone(updated.sharePhone);
      await utils.auth.me.invalidate();
      await utils.user.byId.invalidate();
    },
  });

  if (meQuery.isPending) return <Skeleton height={160} />;
  if (meQuery.isError || !meQuery.data) {
    return <ErrorState message={meQuery.error?.message} onRetry={() => meQuery.refetch()} />;
  }

  const touch = () => setDirty(true);

  const onSave = () => {
    mutation.mutate({
      instagramHandle: instagram.trim(),
      contactPhone: phone.trim(),
      shareInstagram,
      sharePhone,
    });
  };

  return (
    <View style={styles.wrap}>
      <Text variant="caption" color="inkMuted">
        Optional. Nothing here is shown to anyone unless you turn it on, and you can turn it off
        any time.
      </Text>

      <View style={styles.group}>
        <Input
          label="Instagram handle"
          value={instagram}
          onChangeText={(v) => {
            setInstagram(v);
            touch();
          }}
          placeholder="@yourhandle"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          style={styles.input}
        />
        <ShareSwitch
          label="Show my Instagram on my profile"
          hint="Other students who open your profile will see this handle."
          checked={shareInstagram}
          onChange={(v) => {
            setShareInstagram(v);
            touch();
          }}
        />
      </View>

      <View style={styles.group}>
        <Input
          label="Phone number"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            touch();
          }}
          placeholder="(520) 555-1234"
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={40}
          helper="Separate from your sign-in number. Dibbs does not check that it is yours."
          style={styles.input}
        />
        <ShareSwitch
          label="Show my phone number on my profile"
          hint="Other students who open your profile will see this number."
          checked={sharePhone}
          onChange={(v) => {
            setSharePhone(v);
            touch();
          }}
        />
      </View>

      {mutation.isError ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {mutation.error.message}
        </Text>
      ) : null}

      {dirty ? (
        <Button
          title="Save contact sharing"
          onPress={onSave}
          loading={mutation.isPending}
          disabled={mutation.isPending}
          variant="secondary"
          style={styles.save}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  group: { gap: space.sm },
  // 16px minimum stops iOS Safari zooming the page on focus.
  input: { fontSize: 16 },
  switchRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  switchText: { flex: 1, gap: 2 },
  track: {
    width: 52,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.inkMuted,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  trackOn: { backgroundColor: colors.accent },
  thumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
  },
  thumbOn: { alignSelf: 'flex-end' },
  save: { alignSelf: 'flex-start' },
});

export default ContactSharingSection;
