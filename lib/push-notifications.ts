/**
 * Push Notifications Helper
 *
 * Handles registration, permission checking, and scheduling
 * local push notifications via expo-notifications.
 */

import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from 'expo-secure-store';

/** SecureStore keys may only use [A-Za-z0-9._-] — no colons. */
const PUSH_ENABLED_KEY = "rasvia_push_notifications_enabled";
const isExpoGo = Constants.executionEnvironment === "storeClient";
let notificationsImportPromise: Promise<typeof import("expo-notifications") | null> | null = null;
let notificationHandlerConfigured = false;

async function getNotificationsModule(): Promise<typeof import("expo-notifications") | null> {
  if (isExpoGo) return null;
  if (!notificationsImportPromise) {
    notificationsImportPromise = import("expo-notifications").catch(() => null);
  }
  return notificationsImportPromise;
}

async function ensureNotificationHandlerConfigured(): Promise<void> {
  if (notificationHandlerConfigured) return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  // Configure how notifications appear when the app is in the foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  notificationHandlerConfigured = true;
}

/**
 * Check if push notifications are currently enabled (permission granted + user toggle on).
 */
export async function isPushEnabled(): Promise<boolean> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;
  if (!Device.isDevice) return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return false;
  const saved = await SecureStore.getItemAsync(PUSH_ENABLED_KEY);
  return saved !== "false"; // default to true if permission granted
}

/**
 * Get the current OS-level permission status.
 */
export async function getPushPermissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return "denied";
  if (!Device.isDevice) return "denied";
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Request push notification permissions and optionally get the Expo push token.
 * Returns true if permission was granted.
 */
export async function registerForPushNotifications(): Promise<boolean> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return false;
  }
  await ensureNotificationHandlerConfigured();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return false;
  }

  // Set up Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("waitlist", {
      name: "Waitlist Alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF9933",
      sound: "default",
    });
  }

  // Persist the enabled state
  await SecureStore.setItemAsync(PUSH_ENABLED_KEY, "true");
  return true;
}

/**
 * Disable push notifications (user toggle off).
 * Does NOT revoke OS permissions, just disables in-app sending.
 */
export async function disablePushNotifications(): Promise<void> {
  await SecureStore.setItemAsync(PUSH_ENABLED_KEY, "false");
}

/**
 * Enable push notifications (user toggle on).
 * Requests permissions if not already granted.
 */
export async function enablePushNotifications(): Promise<boolean> {
  const granted = await registerForPushNotifications();
  if (granted) {
    await SecureStore.setItemAsync(PUSH_ENABLED_KEY, "true");
  }
  return granted;
}

/**
 * Schedule a local push notification immediately.
 * Only sends if push is enabled.
 */
export async function schedulePushNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await ensureNotificationHandlerConfigured();
  const enabled = await isPushEnabled();
  if (!enabled) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      data: data ?? {},
    },
    trigger: null, // fire immediately
  });
}
