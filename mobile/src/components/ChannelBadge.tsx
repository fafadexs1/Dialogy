import { FontAwesome6 } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import type { Channel } from "@/types";

const channelMeta: Record<Channel, { label: string; icon: keyof typeof FontAwesome6.glyphMap; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: "whatsapp", color: "#25D366" },
  messenger: { label: "Messenger", icon: "facebook-messenger", color: "#3b82f6" },
  telegram: { label: "Telegram", icon: "telegram", color: "#38bdf8" },
  instagram: { label: "Instagram", icon: "instagram", color: "#fb2d74" }
};

export function ChannelBadge({ channel, compact = false }: { channel: Channel; compact?: boolean }) {
  const meta = channelMeta[channel];

  return (
    <View style={[styles.badge, compact && styles.compact]}>
      <FontAwesome6 name={meta.icon} size={compact ? 10 : 12} color={meta.color} />
      {!compact ? <Text style={styles.text}>{meta.label}</Text> : null}
    </View>
  );
}

export function channelLabel(channel: Channel) {
  return channelMeta[channel].label;
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    backgroundColor: "rgba(52,211,153,0.10)",
    borderColor: "rgba(52,211,153,0.28)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  compact: {
    height: 20,
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 0,
    width: 20
  },
  text: {
    color: colors.emerald,
    fontSize: 11,
    fontWeight: "700"
  }
});
