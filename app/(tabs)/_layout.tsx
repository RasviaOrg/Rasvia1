import { Tabs } from "expo-router";

/**
 * Without this, Expo Router may open the first tab alphabetically (`cart` before
 * `index`) on cold start / reload — `Tabs` `initialRouteName` alone is not always honored.
 * @see https://docs.expo.dev/router/advanced/router-settings/
 */
export const unstable_settings = {
  initialRouteName: "index",
};

/**
 * Main tab shell: screens stay mounted when switching tabs (unlike `router.replace`
 * across stack siblings). The visible tab bar is `AppBottomNav` in the root layout.
 */
export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="index"
      tabBar={() => null}
      screenOptions={{
        headerShown: false,
        animation: "none",
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="cart" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
