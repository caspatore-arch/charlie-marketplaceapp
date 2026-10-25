/**
 * The identity block shared by your own profile and everyone else's, so the
 * two read as one design: picture, name, campus, badges, bio, any contact
 * details the person chose to share, and follower / following counts.
 *
 * Counts are popularity. The copy never links them to safety or trust.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Camera } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { DemoBadge } from '@/components/DemoBadge';
import { colors, minTouchHeight, space } from '@/constants/theme';
import type { FollowDirection } from './FollowListPanel';

export interface ProfileHeaderProps {
  displayName: string;
  avatarUrl: string | null | undefined;
  campusName?: string;
  bio?: string | null;
  campusEmailVerified: boolean;
  /** Founder-approved seller. Not a campus, student or ID check. */
  approvedSeller?: boolean;
  isDemo: boolean;
  instagramHandle?: string;
  contactPhone?: string;
  followerCount: number;
  followingCount: number;
  openList: FollowDirection | null;
  onToggleList: (d: FollowDirection) => void;
  /** Own profile only: opens the photo picker. */
  onChangePhoto?: () => void;
  uploading?: boolean;
  uploadError?: string | null;
  /** Follow button (others) or edit link (self). */
  action?: React.ReactNode;
  /** Compact layout: smaller avatar with name, campus and badges beside it. */
  compact?: boolean;
  /** Own profile only: label the demo badge "Demo account". */
  demoAccountLabel?: boolean;
}

function Stat({
  count,
  singular,
  plural,
  active,
  onPress,
}: {
  count: number;
  singular: string;
  plural: string;
  active: boolean;
  onPress: () => void;
}) {
  const label = count === 1 ? singular : plural;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label}. ${active ? 'Hide' : 'Show'} list.`}
      accessibilityState={{ expanded: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.stat, active && styles.statActive, pressed && styles.pressed]}
    >
      <Text variant="heading" weight="700">
        {count}
      </Text>
      <Text variant="label" color="inkMuted">
        {label}
      </Text>
    </Pressable>
  );
}

function CompactHeader(p: ProfileHeaderProps) {
  return (
    <View style={styles.compactHeader}>
      <View style={styles.compactTop}>
        <View style={styles.compactAvatarCol}>
          <View>
            <Avatar uri={p.avatarUrl} name={p.displayName} size={88} />
            {p.uploading ? (
              <View style={[styles.uploading, { borderRadius: 44 }]}>
                <ActivityIndicator color={colors.white} />
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.compactInfo}>
          <Text variant="title" numberOfLines={2}>
            {p.displayName}
          </Text>
          {p.campusName ? (
            <Text variant="label" color="inkMuted" numberOfLines={1}>
              {p.campusName}
            </Text>
          ) : null}
          <View style={styles.compactBadges}>
            {p.campusEmailVerified ? <Badge kind="verified" /> : null}
            {p.approvedSeller ? <Badge kind="status" label="Approved seller" /> : null}
            {p.isDemo ? (
              p.demoAccountLabel ? (
                <View style={styles.demoPill}>
                  <Text variant="caption" weight="600" color="demo">
                    Demo account
                  </Text>
                </View>
              ) : (
                <DemoBadge visible />
              )
            ) : null}
          </View>
        </View>
      </View>
      {p.onChangePhoto ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.avatarUrl ? 'Change profile picture' : 'Add a profile picture'}
          onPress={p.onChangePhoto}
          disabled={p.uploading}
          style={({ pressed }) => [styles.compactChangePhoto, pressed && styles.pressed]}
        >
          <Camera size={18} color={colors.accentInk} />
          <Text variant="label" weight="600" color="accentInk">
            {p.avatarUrl ? 'Change photo' : 'Add a photo'}
          </Text>
        </Pressable>
      ) : null}
      {p.uploadError ? (
        <Text variant="caption" color="danger">
          {p.uploadError}
        </Text>
      ) : null}
      {p.bio ? <Text variant="body">{p.bio}</Text> : null}
      <View style={styles.compactStats}>
        <Stat
          count={p.followerCount}
          singular="follower"
          plural="followers"
          active={p.openList === 'followers'}
          onPress={() => p.onToggleList('followers')}
        />
        <Stat
          count={p.followingCount}
          singular="following"
          plural="following"
          active={p.openList === 'following'}
          onPress={() => p.onToggleList('following')}
        />
      </View>
      {p.action ? <View style={styles.compactAction}>{p.action}</View> : null}
    </View>
  );
}

export function ProfileHeader(p: ProfileHeaderProps) {
  if (p.compact) return <CompactHeader {...p} />;
  return (
    <View style={styles.header}>
      <View>
        <Avatar uri={p.avatarUrl} name={p.displayName} size={96} />
        {p.uploading ? (
          <View style={styles.uploading}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : null}
      </View>
      {p.onChangePhoto ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.avatarUrl ? 'Change profile picture' : 'Add a profile picture'}
          onPress={p.onChangePhoto}
          disabled={p.uploading}
          style={({ pressed }) => [styles.changePhoto, pressed && styles.pressed]}
        >
          <Camera size={18} color={colors.accent} />
          <Text variant="label" weight="600" color="accent">
            {p.avatarUrl ? 'Change photo' : 'Add a photo'}
          </Text>
        </Pressable>
      ) : null}
      {p.uploadError ? (
        <Text variant="caption" color="danger">
          {p.uploadError}
        </Text>
      ) : null}

      <Text variant="title" style={styles.name}>
        {p.displayName}
      </Text>
      {p.campusName ? (
        <Text variant="body" color="inkMuted">
          {p.campusName}
        </Text>
      ) : null}
      <View style={styles.badgeRow}>
        {p.campusEmailVerified ? <Badge kind="verified" /> : null}
        {p.approvedSeller ? <Badge kind="status" label="Approved seller" /> : null}
        <DemoBadge visible={p.isDemo} />
      </View>

      {p.bio ? (
        <Text variant="body" style={styles.bio}>
          {p.bio}
        </Text>
      ) : null}

      <View style={styles.stats}>
        <Stat
          count={p.followerCount}
          singular="follower"
          plural="followers"
          active={p.openList === 'followers'}
          onPress={() => p.onToggleList('followers')}
        />
        <Stat
          count={p.followingCount}
          singular="following"
          plural="following"
          active={p.openList === 'following'}
          onPress={() => p.onToggleList('following')}
        />
      </View>

      {p.action ? <View style={styles.action}>{p.action}</View> : null}

      {p.instagramHandle || p.contactPhone ? (
        <View style={styles.contactBlock} accessibilityLabel="Contact details this student chose to share">
          {p.instagramHandle ? (
            <Text variant="body" selectable>
              Instagram: @{p.instagramHandle}
            </Text>
          ) : null}
          {p.contactPhone ? (
            <View style={styles.contactBlock}>
              <Text variant="body" selectable>
                Phone: {p.contactPhone}
              </Text>
              <Text variant="caption" color="inkMuted">
                Unverified. This is a number they typed in; Dibbs has not checked it.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  compactHeader: { gap: space.sm, paddingVertical: space.lg },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  compactAvatarCol: { alignItems: 'center' },
  compactInfo: { flex: 1, gap: space.xs },
  compactBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  compactChangePhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: minTouchHeight,
    alignSelf: 'flex-start',
  },
  compactStats: { flexDirection: 'row', gap: space.sm },
  compactAction: { alignItems: 'stretch' },
  demoPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.demoSoft,
  },
  header: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  uploading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 48,
    backgroundColor: 'rgba(22,21,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: minTouchHeight,
    paddingHorizontal: space.md,
  },
  name: { marginTop: space.xs },
  badgeRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  bio: { textAlign: 'center', marginTop: space.md, paddingHorizontal: space.lg },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  stat: {
    minHeight: minTouchHeight,
    minWidth: 110,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  statActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
  action: { marginTop: space.md, alignItems: 'center' },
  contactBlock: { alignItems: 'center', gap: space.xs, marginTop: space.md },
  pressed: { opacity: 0.8 },
});

export default ProfileHeader;
