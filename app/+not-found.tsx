/**
 * Dead-link screen. A /listing/… path is the likely case (listings expire after
 * 24 hours or get removed), so it gets listing-specific wording. Either way
 * the primary action is a Browse button.
 */
import { Stack, useRouter, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Compass } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, space } from '@/constants/theme';

export default function NotFoundScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const isListing = pathname.startsWith('/listing/');

  return (
    <>
      <Stack.Screen options={{ title: isListing ? 'Listing not found' : 'Not found' }} />
      <Screen>
        <EmptyState
          icon={<Compass size={40} color={colors.inkFaint} />}
          title={isListing ? 'This listing may have expired or been removed' : "This screen doesn't exist"}
          body={
            isListing
              ? 'Listings disappear after 24 hours or when the seller takes them down. See what is new on campus.'
              : 'The link you followed may be broken, or the page may have been removed.'
          }
        />
        <View style={styles.action}>
          <Button
            title="Browse listings"
            size="lg"
            icon={<Compass size={20} color={colors.white} />}
            onPress={() => router.replace('/')}
          />
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', marginTop: space.md },
});
