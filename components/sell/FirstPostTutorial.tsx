/**
 * First-post guide: three short steps, shown once automatically (marked done on
 * ANY dismissal, including Android back) and replayable from the "Tips" link in
 * the New listing header. The parent passes `replay` (a counter) to reopen it.
 */
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { colors, space, radius } from '@/constants/theme';

const STEPS = [
  ['Show the real item', 'Clear photos from a few angles, including any wear or damage. Add flaws and measurements in the description.'],
  ['Price it to sell', 'Pick a price you would take today. Buyers book your price and a time, so there is no haggling. You keep 100%.'],
  ['Pick spots and times', 'Choose public campus spots and the hours you can meet. Your listing is live for 24 hours, and buyers book a 15-minute slot.'],
];

export function FirstPostTutorial({ userId, replay = 0 }: { userId: string; replay?: number }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const key = `dibbs:first-listing-guide:v1:${userId}`;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then((seen) => { if (active) setVisible(seen !== 'done'); }).catch(() => { if (active) setVisible(true); });
    return () => { active = false; };
  }, [key]);
  // Reopen when the parent's Tips link bumps `replay` (state adjusted during render, not in an effect).
  const [seenReplay, setSeenReplay] = useState(replay);
  if (replay !== seenReplay) {
    setSeenReplay(replay);
    setStep(0);
    setVisible(true);
  }
  async function finish() {
    setVisible(false);
    try { await AsyncStorage.setItem(key, 'done'); } catch { /* Guide stays replayable from Tips if storage is unavailable. */ }
  }
  const last = step === STEPS.length - 1;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void finish()}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.lg, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg }}>
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.lg }}>
            <Text variant="caption" color="accentInk" accessibilityLiveRegion="polite">TIPS · {step + 1} OF {STEPS.length}</Text>
            <Text variant="title" accessibilityRole="header">{STEPS[step][0]}</Text>
            <Text variant="body">{STEPS[step][1]}</Text>
            <Button title={last ? 'Start my listing' : 'Next'} onPress={() => (last ? void finish() : setStep(step + 1))} />
            {step > 0 ? <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} /> : null}
            <Button title="Skip" variant="ghost" onPress={() => void finish()} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
