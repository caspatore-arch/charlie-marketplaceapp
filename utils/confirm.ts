/**
 * Confirmation dialog helper. `Alert.alert` with a button array silently
 * no-ops on React Native Web (no dialog is shown and no callback fires), so
 * any destructive action gated behind it becomes unreachable in a browser.
 * This falls back to `window.confirm` on web and uses the native Alert
 * elsewhere.
 */
import { Alert, Platform } from 'react-native';

export function confirmAction(
  title: string,
  message: string | undefined,
  confirmLabel: string,
  onConfirm: () => void,
  options?: { cancelLabel?: string; destructive?: boolean },
): void {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== 'undefined' && window.confirm(text)) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: options?.cancelLabel ?? 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: options?.destructive ?? true ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
