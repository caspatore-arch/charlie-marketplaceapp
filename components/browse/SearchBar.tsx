/**
 * Search field pinned above the filter row on Browse. Rounded input with a
 * leading search icon and a trailing clear (×) button once there's text.
 * Purely controlled — the parent owns debouncing before the value reaches
 * `listing.feed`'s `q` param.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';

export interface SearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search listings' }: SearchBarProps) {
  return (
    <View style={styles.wrap}>
      <Search size={18} color={colors.inkFaint} style={styles.leadingIcon} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
        allowFontScaling
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={80}
        accessibilityLabel="Search listings"
        accessibilityHint="Filters the feed by title, brand, or description"
        clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
      />
      {value.length > 0 && Platform.OS !== 'ios' ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={12}
          style={styles.clearBtn}
        >
          <X size={16} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouchHeight,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  leadingIcon: { marginRight: space.sm },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: space.sm,
  },
  clearBtn: {
    marginLeft: space.sm,
    padding: space.xs,
  },
});

export default SearchBar;
