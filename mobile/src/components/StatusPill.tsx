import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";

export function StatusPill({ label }: { label: string }) {
  return (
    <View style={styles.root}>
      <View style={styles.dot} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  dot: {
    backgroundColor: colors.emerald,
    borderRadius: 999,
    height: 8,
    width: 8
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700"
  }
});
