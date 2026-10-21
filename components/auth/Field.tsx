/**
 * Labelled input whose error/helper text is announced politely to screen
 * readers (live region on the wrapper) — `Input` itself has none.
 */
import React, { forwardRef } from 'react';
import { View, type TextInput } from 'react-native';
import { Input, type InputProps } from '@/components/ui/Input';

export const Field = forwardRef<TextInput, InputProps>(function Field(props, ref) {
  return (
    <View accessibilityLiveRegion="polite" style={{ width: '100%' }}>
      <Input ref={ref} {...props} />
    </View>
  );
});

export default Field;
