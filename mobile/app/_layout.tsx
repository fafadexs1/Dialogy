import "react-native-url-polyfill/auto";
import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { InboxProvider } from "@/state/InboxContext";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <InboxProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#050507" },
            headerShown: false
          }}
        />
      </InboxProvider>
    </GestureHandlerRootView>
  );
}
