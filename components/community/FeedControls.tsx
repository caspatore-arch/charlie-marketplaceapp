/**
 * Category tabs (Buyers / Sellers) and sort pills (Top / Newest / Hottest).
 * Selection is shown by more than colour: bold weight, a thick underline on
 * the tab, and a check mark plus a heavier border on the pill.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import type { CommunityPostKind } from '@/types';

export type CommunitySort = 'top' | 'new' | 'hot';

const CATEGORIES: { kind: CommunityPostKind; label: string; hint: string }[] = [
  { kind: 'buying', label: 'Buyers', hint: 'Posts from people looking to buy' },
  { kind: 'selling', label: 'Sellers', hint: 'Posts from people selling' },
];

const SORTS: { sort: CommunitySort; label: string; hint: string }[] = [
  { sort: 'top', label: 'Top', hint: 'Highest score first (upvotes minus downvotes)' },
  { sort: 'new', label: 'Newest', hint: 'Most recent first' },
  { sort: 'hot', label: 'Hottest', hint: 'Highest score in the last hour or so' },
];

export interface FeedControlsProps {
  kind: CommunityPostKind;
  sort: CommunitySort;
  onKind: (k: CommunityPostKind) => void;
  onSort: (s: CommunitySort) => void;
  /** Whether listing posts are shown in the feed. */
  showListings: boolean;
  onShowListings: (show: boolean) => void;
}

export function FeedControls({ kind, sort, onKind, onSort, showListings, onShowListings }: FeedControlsProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {CATEGORIES.map((c) => {
          const selected = kind === c.kind;
          return (
            <Pressable
              key={c.kind}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${c.label}. ${c.hint}`}
              onPress={() => onKind(c.kind)}
              style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
            >
              <Text variant="heading" weight={selected ? '700' : '500'} color={selected ? 'ink' : 'inkMuted'}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sorts} accessibilityRole="radiogroup" accessibilityLabel="Sort posts">
        {SORTS.map((s) => {
          const selected = sort === s.sort;
          return (
            <Pressable
              key={s.sort}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={`${s.label}. ${s.hint}`}
              onPress={() => onSort(s.sort)}
              style={({ pressed }) => [styles.pill, selected && styles.pillSelected, pressed && styles.pressed]}
            >
              {selected ? <Check size={16} color={colors.accentInk} strokeWidth={3} /> : null}
              <Text variant="label" weight={selected ? '700' : '500'} color={selected ? 'accentInk' : 'ink'}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: showListings }}
          accessibilityLabel={`Show listings, ${showListings ? 'on' : 'off'}`}
          accessibilityHint="Show or hide items for sale in this feed"
          onPress={() => onShowListings(!showListings)}
          style={({ pressed }) => [styles.pill, showListings && styles.pillSelected, pressed && styles.pressed]}
        >
          {showListings ? <Check size={16} color={colors.accentInk} strokeWidth={3} /> : null}
          <Text variant="label" weight={showListings ? '700' : '500'} color={showListings ? 'accentInk' : 'ink'}>
            {showListings ? 'Listings: on' : 'Listings: off'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabSelected: { borderBottomColor: colors.accent },
  // Wraps rather than overflowing if the font is scaled up or the screen is narrow.
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pillSelected: { borderColor: colors.accentInk, borderWidth: 2, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
});

export default FeedControls;
