/**
 * Never actually shown: the tab layout's tabPress listener intercepts taps on
 * "Sell" and pushes /listing/new as a modal before this screen mounts. This
 * file exists only so the route is valid for expo-router's typed routes.
 */
import { Redirect } from 'expo-router';

export default function SellTabRedirect() {
  return <Redirect href="/" />;
}
