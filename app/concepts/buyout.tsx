/**
 * Hidden concept route. Disabled unless EXPO_PUBLIC_ENABLE_CONCEPTS === '1'.
 * Deliberately not linked from any navigation, tab, settings, or screen.
 */
import React from 'react';
import { Screen, Text } from '@/components/ui';
import { BuyoutConceptScreen } from '@/prototypes/buyout/BuyoutConceptScreen';

export default function BuyoutConceptRoute() {
  if (process.env.EXPO_PUBLIC_ENABLE_CONCEPTS !== '1') {
    return (
      <Screen>
        <Text variant="title">This concept is disabled</Text>
        <Text color="inkMuted">It is a design prototype and is not part of the live app.</Text>
      </Screen>
    );
  }
  return <BuyoutConceptScreen />;
}
