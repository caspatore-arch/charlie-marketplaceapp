/**
 * Normally never shown: the tab layout's tabPress listener intercepts taps on
 * "Sell" and pushes /listing/new as a modal before this screen mounts. This
 * route is still reachable by deep link or web visit to /sell, which opens the
 * new-listing form (that screen handles the signed-out case itself).
 */
import { Redirect } from 'expo-router';

export default function SellTabRedirect() {
  return <Redirect href="/listing/new" />;
}
