/**
 * Red / orange / green price bar under the Sell form's asking price.
 *
 * The average comes from similar Dibbs listings (listing.priceGuide). When
 * there are too few of those, it falls back to the AI's estimate from the
 * photos, and says so: the label always names where the number came from.
 *
 * Zones, relative to the average A:
 *   green   price <= A           likely to sell fast
 *   orange  A < price <= 1.25A   may take longer
 *   red     price > 1.25A        well above similar items
 * The bar spans 0.25A to 1.75A, so the average sits in the middle.
 */
import React, { useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { trpc } from "@/lib/trpc";
import { colors, radius, space } from "@/constants/theme";
import type { Category } from "@/constants/campus";

/** Graphic fills only (never text), so they don't need text contrast. */
const ZONE = {
  green: "#3FA968",
  orange: "#F29A2E",
  red: "#E5484D",
} as const;

const BAR_MIN = 0.25;
const BAR_MAX = 1.75;
const ORANGE_FROM = 1;
const RED_FROM = 1.25;

type Zone = keyof typeof ZONE;

export function zoneFor(priceCents: number, averageCents: number): Zone {
  if (priceCents <= averageCents) return "green";
  if (priceCents <= averageCents * RED_FROM) return "orange";
  return "red";
}

function pct(ratio: number): number {
  return Math.min(
    100,
    Math.max(0, ((ratio - BAR_MIN) / (BAR_MAX - BAR_MIN)) * 100),
  );
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const MESSAGE: Record<Zone, string> = {
  green: "Priced to sell. At or below what similar items go for.",
  orange: "A bit above average. It may take longer to sell.",
  red: "Higher than most similar items. Expect fewer buyers or lower offers.",
};

export interface PriceGuideBarProps {
  category: Category | null;
  title: string;
  priceCents: number | null;
  /** From photo autofill; used only when Dibbs has too few similar items. */
  aiEstimate?: { lowCents: number; highCents: number } | null;
  excludeListingId?: string;
  /** Sets the asking price (the "Use $X" shortcut). */
  onUsePrice: (cents: number) => void;
}

export function PriceGuideBar({
  category,
  title,
  priceCents,
  aiEstimate,
  excludeListingId,
  onUsePrice,
}: PriceGuideBarProps) {
  const debouncedTitle = useDebounced(title.trim(), 500);
  const guide = trpc.listing.priceGuide.useQuery(
    {
      category: category!,
      title: debouncedTitle || undefined,
      excludeListingId,
    },
    { enabled: !!category, placeholderData: (prev) => prev, staleTime: 60_000 },
  );

  const fromDibbs =
    guide.data && guide.data.count > 0 && guide.data.averageCents
      ? guide.data
      : null;
  const averageCents = fromDibbs
    ? fromDibbs.averageCents!
    : aiEstimate
      ? Math.round((aiEstimate.lowCents + aiEstimate.highCents) / 2)
      : null;

  // Pop in once there is something to show.
  const [appear] = useState(() => new Animated.Value(0));
  const visible = !!category && averageCents !== null;
  useEffect(() => {
    Animated.timing(appear, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [visible, appear]);

  if (!category) return null;
  if (averageCents === null) {
    if (guide.isPending) return null;
    return (
      <Text variant="caption" color="inkMuted" style={styles.empty}>
        Not enough similar items on Dibbs yet to show a price guide.
      </Text>
    );
  }

  const hasPrice = priceCents !== null && priceCents >= 100;
  const zone = hasPrice ? zoneFor(priceCents!, averageCents) : null;
  // Kept a few percent in from each end so the ring never overhangs the bar.
  const markerLeft = hasPrice
    ? Math.min(96, Math.max(4, pct(priceCents! / averageCents)))
    : null;
  // Nudge: a whole-dollar price a little under the average.
  const suggestCents = Math.max(
    100,
    Math.floor((averageCents * 0.9) / 100) * 100,
  );

  const source = fromDibbs
    ? `Based on ${fromDibbs.count} ${fromDibbs.basis === "similar_titles" ? "similar" : "same-category"} item${
        fromDibbs.count === 1 ? "" : "s"
      } on Dibbs${fromDibbs.includesDemo ? ", including demo listings" : ""}.`
    : "AI estimate from your photos, not real sales data.";

  const a11y = `Similar items average ${dollars(averageCents)}.${
    zone
      ? ` Your price, ${dollars(priceCents!)}, is in the ${zone} zone. ${MESSAGE[zone]}`
      : ""
  }`;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
      accessible
      accessibilityLabel={a11y}
    >
      <View style={styles.headerRow}>
        <Text variant="label">Price guide</Text>
        <Text variant="label" color="inkMuted">
          Avg. {dollars(averageCents)}
        </Text>
      </View>

      <View style={styles.trackWrap}>
        <View style={styles.track}>
          <View
            style={[
              styles.segment,
              { flex: pct(ORANGE_FROM), backgroundColor: ZONE.green },
            ]}
          />
          <View
            style={[
              styles.segment,
              {
                flex: pct(RED_FROM) - pct(ORANGE_FROM),
                backgroundColor: ZONE.orange,
              },
            ]}
          />
          <View
            style={[
              styles.segment,
              { flex: 100 - pct(RED_FROM), backgroundColor: ZONE.red },
            ]}
          />
        </View>
        <View style={[styles.avgTick, { left: `${pct(1)}%` }]} />
        {markerLeft !== null ? (
          <View
            style={[
              styles.marker,
              { left: `${markerLeft}%`, borderColor: ZONE[zone!] },
            ]}
          />
        ) : null}
      </View>

      <View style={styles.scaleRow}>
        <Text variant="caption" color="inkMuted">
          Sells fast
        </Text>
        <Text variant="caption" color="inkMuted">
          Sits longer
        </Text>
      </View>

      <Text variant="body" style={styles.message}>
        {zone
          ? MESSAGE[zone]
          : `Similar items average ${dollars(averageCents)}. Pricing at or below that helps it sell fast.`}
      </Text>

      {/* Space is reserved even when the pill is hidden, so the form below doesn't jump. */}
      <View style={styles.useRow}>
        {zone && zone !== "green" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${dollars(suggestCents)} as the asking price`}
            onPress={() => onUsePrice(suggestCents)}
            style={({ pressed }) => [
              styles.useBtn,
              pressed && styles.useBtnPressed,
            ]}
            hitSlop={6}
          >
            <Text variant="label" color="accentInk">
              Use {dollars(suggestCents)}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text variant="caption" color="inkMuted" style={styles.source}>
        {source}
      </Text>
    </Animated.View>
  );
}

const TRACK_HEIGHT = 10;
const MARKER = 20;

const styles = StyleSheet.create({
  empty: { marginTop: space.sm },
  card: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  trackWrap: { marginTop: space.md, height: MARKER, justifyContent: "center" },
  track: {
    flexDirection: "row",
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  segment: { height: TRACK_HEIGHT },
  avgTick: {
    position: "absolute",
    width: 2,
    height: MARKER,
    marginLeft: -1,
    backgroundColor: colors.ink,
    opacity: 0.35,
  },
  marker: {
    position: "absolute",
    width: MARKER,
    height: MARKER,
    marginLeft: -MARKER / 2,
    borderRadius: MARKER / 2,
    borderWidth: 4,
    backgroundColor: colors.surface,
  },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space.xs,
  },
  message: { marginTop: space.sm },
  useRow: { marginTop: space.sm, minHeight: 34, justifyContent: "center" },
  useBtn: {
    alignSelf: "flex-start",
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  useBtnPressed: { opacity: 0.7 },
  source: { marginTop: space.sm },
});

export default PriceGuideBar;
