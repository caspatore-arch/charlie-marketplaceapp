import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { colors, space, radius } from '@/constants/theme';

const STEPS = [
  ['Show the real item', 'Add clear photos from a few angles. Include wear or damage so buyers know what they’re getting. People can swipe through your photos.'],
  ['Help buyers find it', 'Give it a specific title, choose a category and condition, and add size or brand when relevant. Use the description for measurements, what’s included, and any flaws.'],
  ['Choose an asking price', 'Enter the amount in dollars. Compare similar used items and account for condition. Buyers can book at your asking price or send a lower offer for you to accept or decline.'],
  ['Choose campus meetup spots', 'Select the public campus locations where you can actually meet. Buyers choose from your locations when booking.'],
  ['Set hours you can meet', 'Tap individual hours or add a custom window in the next 24 hours. Buyers book an exact 30-minute slot inside your availability. Times use your campus timezone.'],
  ['Publish, share, and hand it over', 'Review your details, then publish. Your listing lasts 24 hours. Copy its link or share it from the confirmation screen. Check Meetups & messages for bookings; meet in public, inspect the item, arrange payment directly, and confirm the handoff.'],
];

export function FirstPostTutorial({ userId }: { userId: string }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const key = `dibbs:first-listing-guide:v1:${userId}`;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then((seen) => { if (active) setVisible(seen !== 'done'); }).catch(() => { if (active) setVisible(true); });
    return () => { active = false; };
  }, [key]);
  async function finish() {
    setVisible(false);
    try { await AsyncStorage.setItem(key, 'done'); } catch { /* Guide remains replayable if storage is unavailable. */ }
  }
  return <>
    <Button title="How to make a great first post" variant="ghost" onPress={() => { setStep(0); setVisible(true); }} />
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.lg, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg }}>
          <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.lg }}>
            <Text variant="caption" color="accentInk" accessibilityLiveRegion="polite">YOUR FIRST POST · {step + 1} OF {STEPS.length}</Text>
            <Text variant="title" accessibilityRole="header">{STEPS[step][0]}</Text>
            <Text variant="body">{STEPS[step][1]}</Text>
            <Button title={step === STEPS.length - 1 ? 'Start my listing' : 'Next'} onPress={() => step === STEPS.length - 1 ? void finish() : setStep(step + 1)} />
            {step > 0 ? <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} /> : null}
            <Button title="Skip tutorial" variant="ghost" onPress={finish} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
