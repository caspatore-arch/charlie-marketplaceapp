/**
 * Shared "Reduce Motion" flag. One module-level subscription instead of one
 * AccessibilityInfo call per card: a feed mounts dozens of cells, and each
 * asking the OS separately is wasted work. On web, react-native-web backs this
 * with the `prefers-reduced-motion` media query.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let current = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled?.().then(set).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', set);
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return current;
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
