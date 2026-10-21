/**
 * One-shot confetti built on react-native-reanimated (no extra package).
 * A single shared progress value (0 -> 1) drives every particle; when it
 * finishes the component unmounts itself, so nothing animates afterwards.
 * Skipped entirely under Reduce Motion. Never intercepts touches.
 */
/* eslint-disable react-hooks/immutability */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/theme';
import { useReduceMotion } from '@/components/browse/useReduceMotion';

const PARTICLES = 40;
const DURATION_MS = 2600;
const PALETTE = [colors.brand, colors.accent, colors.brand, colors.ink, colors.inkMuted, colors.line];

interface Spec {
  x: number; // 0..1 start column
  drift: number; // horizontal sway amplitude, px
  phase: number;
  delay: number; // 0..0.35 of the timeline
  size: number;
  ratio: number;
  spin: number; // total degrees
  color: string;
}

// Deterministic PRNG so renders are stable and tests are repeatable.
function makeSpecs(): Spec[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: PARTICLES }, (_, i) => ({
    x: rnd(),
    drift: 20 + rnd() * 40,
    phase: rnd() * Math.PI * 2,
    delay: rnd() * 0.35,
    size: 7 + rnd() * 6,
    ratio: 0.5 + rnd() * 0.9,
    spin: 360 + rnd() * 720,
    color: PALETTE[i % PALETTE.length]!,
  }));
}

function Particle({ spec, progress, width, height }: { spec: Spec; progress: SharedValue; width: number; height: number }) {
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (progress.value - spec.delay) / (1 - spec.delay)));
    return {
      opacity: t === 0 ? 0 : t > 0.8 ? (1 - t) / 0.2 : 1,
      transform: [
        { translateX: spec.x * width + Math.sin(t * 6 + spec.phase) * spec.drift },
        { translateY: -20 + t * (height + 40) },
        { rotate: `${t * spec.spin}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.particle,
        { width: spec.size, height: spec.size * spec.ratio, backgroundColor: spec.color },
        style,
      ]}
    />
  );
}

type SharedValue = ReturnType<typeof useSharedValue<number>>;

export function Confetti() {
  const reduceMotion = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const specs = useMemo(makeSpecs, []);
  const progress = useSharedValue(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withTiming(1, { duration: DURATION_MS, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(setDone)(true);
    });
    return () => {
      progress.value = 0;
    };
  }, [reduceMotion, progress]);

  if (reduceMotion || done) return null;

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {specs.map((s, i) => (
        <Particle key={i} spec={s} progress={progress} width={width} height={height} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  particle: { position: 'absolute', top: 0, left: 0, borderRadius: 2 },
});
