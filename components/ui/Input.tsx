/**
 * Text input with label/helper/error. Usage:
 * <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" error={emailError} />
 * <TextArea label="Description" value={desc} onChangeText={setDesc} />
 */
import React, { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, helper, error, style, ...rest },
  ref,
) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" color="inkMuted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.inkFaint}
        allowFontScaling
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger" style={styles.helper}>
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" color="inkFaint" style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

export const TextArea = forwardRef<TextInput, InputProps>(function TextArea(
  { label, helper, error, style, ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      label={label}
      helper={helper}
      error={error}
      multiline
      numberOfLines={4}
      style={[styles.textArea, style]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  label: { marginBottom: space.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: space.md },
  helper: { marginTop: space.xs },
});

export default Input;
