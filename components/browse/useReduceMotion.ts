/**
 * Shared "Reduce Motion" flag. One module-level subscription instead of one
 * AccessibilityInfo call per card: a feed mounts dozens of cells, and each
 * asking the OS separately is wasted work. On web, react-native-web backs this
 * with the `prefers-reduced-motion` media query.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let current = false;
let started = false;
const listeners = new Set<(v: boolean) => void>();

function set(next: boolean) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l(next));
}

function start() {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled?.().then(set).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', set);
}

export function useReduceMotion(): boolean {
  const [value, setValue] = useState(current);
  useEffect(() => {
    start();
    listeners.add(setValue);
    setValue(current);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
