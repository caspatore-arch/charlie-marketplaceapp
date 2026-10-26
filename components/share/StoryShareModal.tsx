/**
 * Small sheet for a seller's own live listing: the same "Share to your story"
 * image builder the post-publish modal uses. Dibbs cannot post to Instagram or
 * Snapchat; the person saves or shares the image and adds it to their own story.
 */
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { colors, radius, shadow, space } from "@/constants/theme";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { StorySection } from "./StorySection";

interface Props {
  listing: {
    title: string;
    priceCents: number;
    coverPhotoUrl: string | null;
  } | null;
  onClose: () => void;
}

export function StoryShareModal({ listing, onClose }: Props) {
  if (!listing) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close story sharing"
          onPress={onClose}
        />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text variant="title" accessibilityRole="header">
              Share to your story
            </Text>
            <StorySection listing={listing} />
            <Button title="Done" variant="ghost" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: space.lg,
    backgroundColor: "rgba(22,21,19,0.55)",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "92%",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  content: { padding: space.xl, gap: space.lg },
});
