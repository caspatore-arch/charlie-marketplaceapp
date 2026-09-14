import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { space } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen>
        <EmptyState
          title="This screen doesn't exist"
          body="The link you followed may be broken, or the page may have been removed."
        />
        <Link href="/" style={styles.link}>
          <Text variant="label" color="accent" weight="600">
            Go to Browse
          </Text>
        </Link>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', marginTop: space.md, padding: space.sm },
});
