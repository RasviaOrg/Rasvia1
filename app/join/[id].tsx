// app/join/[id].tsx
// Group Order Bridge — mobile (schema_version = 2)
//
// Four stages:
//   1) Name entry            — guest picks/enters display name, joins session
//   2) Browse & Add          — session.status = 'open'
//   3) Review & Split / Pay  — session.status in ('locked','paying')
//   4) Success               — session.status = 'submitted' or 'completed'
//
// Host controls are gated by member.role === 'host'. Every mutation flows
// through the shared contract in `lib/party-session.ts`.
import { useEffect, useMemo, useRef, useState, useCallback, createContext, useContext, type ReactElement } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, ScrollView, Platform,
  KeyboardAvoidingView, Alert, ActivityIndicator, StyleSheet, Image, Share, Modal,
} from 'react-native';
import { CachedImage } from '../../components/CachedImage';
import { ImageFetchProvider } from '../../lib/image-fetch-context';
import { prefetchImages } from '../../lib/image-cache';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import Animated, {
  FadeIn, FadeInDown, FadeInUp, FadeOut, FadeOutDown,
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence,
  Easing,
} from 'react-native-reanimated';
import {
  ArrowLeft, Plus, Minus, ShoppingCart, Crown, Copy, Share2, Check,
  X, Users, DollarSign, Leaf, Flame, Search, ChevronRight, Info,
  Lock, Unlock, CreditCard, Trash2, AlertCircle, PartyPopper,
} from 'lucide-react-native';

import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth-context';
import { useNotifications } from '../../lib/notifications-context';
import {
  joinSession, completeJoinCredentials, reissuePartyMemberToken, addItem, updateItemQuantity, removeItem,
  isPartyUnauthorizedMessage,
  setPaymentMode, setItemSplit, assignItemPayer,
  lockSession, unlockSession, startCheckout, cancelSession, leaveSession,
  setHostInReview, fetchSnapshot, CheckoutError,
  formatCents, memberById, paymentForMember, isFullyPaid, totalCartCents,
  type PartyCreds, type PartySnapshot, type PaymentMode, type PartyMember, type PartyItem,
} from '../../lib/party-session';
import {
  loadPartyCreds, savePartyCreds, clearPartyCreds,
} from '../../lib/party-credentials';
import { addActiveParty, removeActiveParty } from '../../lib/party-active';
import { subscribeToParty } from '../../lib/party-realtime';
import { PartyLedger, colorForMember, memberInitials } from '../../components/party/PartyLedger';
import { DEFAULT_MENU_TAGS, parseRestaurantMenuTags, normalizeMenuItemTags, type MenuTagConfig } from '../../lib/menu-tags';
import { useAppTheme, type AppColors } from '../../lib/app-theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TaxEstimateLine } from '../../components/TaxEstimateLine';
import { estimatedTaxCentsFromCents, formatCentsUsd, bpsToPercentLabel, resolveDisplayTaxRateBps } from '../../lib/texas-sales-tax-estimate';
import { useCartTax } from '../../hooks/useCartTax';



function createJoinPartyStyles(colors: AppColors, isDark: boolean) {
  const sheetScrim = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)';
  const hairline = colors.cardBorder;
  /** Solid CTAs: bright saffron reads harsh on light grey; burnt orange + white label reads cleaner. */
  const primaryBtnBg = isDark ? '#FF9933' : '#f97316';
  const primaryBtnFg = '#ffffff';
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
    errorText: { color: colors.textMuted, textAlign: 'center' },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FF9933' },
    retryBtnText: { color: '#0f0f0f', fontWeight: '700' },

    joinContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 20 },
    joinCard: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 24, padding: 26, borderWidth: 1, borderColor: hairline },
    joinBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,153,51,0.12)', marginBottom: 12 },
    joinBadgeText: { color: '#FF9933', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    joinTitle: { color: colors.text, fontSize: 26, fontWeight: '900', lineHeight: 32 },
    joinSubtitle: { color: colors.textMuted, marginTop: 8, fontSize: 14, lineHeight: 20 },
    nameInput: { marginTop: 18, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: colors.text, fontSize: 16 },
    joinNotNowBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: hairline, backgroundColor: colors.card },
    joinNotNowText: { color: colors.textMuted, fontWeight: '700' },

    topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12, gap: 8 },
    topTitle: { color: colors.text, fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18 },
    topSubtitle: { color: colors.textMuted, fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 2 },

    membersStrip: { marginTop: 6, marginBottom: 6, height: 56, flexGrow: 0, flexShrink: 0 },
    memberChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: hairline },
    memberChipText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600', maxWidth: 165 },
    memberChipCount: { marginLeft: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,153,51,0.15)', minWidth: 18, alignItems: 'center' },
    memberChipCountText: { color: '#FF9933', fontSize: 10, fontWeight: '800' },
    avatarSm: { width: 27, height: 27, borderRadius: 13.5, alignItems: 'center', justifyContent: 'center', position: 'relative' },
    avatarSmText: { color: '#0f0f0f', fontWeight: '800', fontSize: 11 },
    avatarMd: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', position: 'relative' },
    avatarMdText: { color: '#0f0f0f', fontWeight: '900', fontSize: 15 },
    crownBadge: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },

    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 4, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: hairline },
    searchInput: { flex: 1, color: colors.text, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },

    catChip: { minHeight: 38, paddingHorizontal: 15, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: hairline, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
    catChipActive: { backgroundColor: '#FF9933', borderColor: '#FF9933' },
    catChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600', lineHeight: 16 },
    catChipTextActive: { color: '#0f0f0f' },

    menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: colors.card, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: hairline },
    menuImg: { width: 56, height: 56, borderRadius: 10 },
    menuName: { color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 },
    menuDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    menuPrice: { color: '#FF9933', fontWeight: '800', fontSize: 13, marginTop: 4 },
    addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF9933', alignItems: 'center', justifyContent: 'center', position: 'relative' },
    addBtnCount: { position: 'absolute', top: -6, right: -6, backgroundColor: colors.background, color: '#FF9933', fontSize: 10, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', fontWeight: '800', borderWidth: 1, borderColor: '#FF9933' },

    cartContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 20, backgroundColor: colors.card, borderTopWidth: 1, borderColor: hairline },
    cartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    cartTitle: { color: colors.text, fontWeight: '700' },
    cartTotal: { color: '#FF9933', fontWeight: '800', marginLeft: 'auto' },
    cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: hairline },
    cartItemName: { color: colors.text, fontWeight: '700', fontSize: 13 },
    cartItemMeta: { color: colors.textMuted, fontSize: 11 },
    qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.pressableBg, alignItems: 'center', justifyContent: 'center' },
    qtyTrashBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(220,38,38,0.18)' : 'rgba(220,38,38,0.14)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(220,38,38,0.55)' : 'rgba(185,28,28,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyText: { color: colors.text, fontWeight: '700', width: 22, textAlign: 'center' },

    primaryBtn: { backgroundColor: primaryBtnBg, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    primaryBtnText: { color: primaryBtnFg, fontWeight: '800', fontSize: 15 },
    secondaryBtn: { backgroundColor: colors.card, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: hairline },
    secondaryBtnText: { color: colors.textMuted, fontWeight: '700' },
    dangerBtn: { backgroundColor: 'rgba(239,68,68,0.08)', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' },
    dangerBtnText: { color: '#EF4444', fontWeight: '700' },
    dangerBtnSolid: { backgroundColor: '#EF4444', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
    dangerBtnSolidText: { color: '#FFF', fontWeight: '800' },
    textBtn: { paddingVertical: 12, alignItems: 'center' },
    textBtnText: { color: colors.textMuted },

    headerCard: { backgroundColor: colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: hairline },
    summaryLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
    summaryValue: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 4 },
    summaryMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },

    sectionLabel: { color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 22, marginBottom: 10 },

    modeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: hairline },
    modeCardActive: { borderColor: '#FF9933', backgroundColor: isDark ? 'rgba(255,153,51,0.08)' : 'rgba(255,153,51,0.12)' },
    modeTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
    modeSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

    assignRow: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: hairline },
    assignName: { color: colors.text, fontWeight: '700', marginBottom: 8 },
    assignPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.pressableBg, borderWidth: 1, borderColor: hairline, maxWidth: 120 },
    assignPillActive: {
      backgroundColor: isDark ? 'rgba(255,153,51,0.22)' : 'rgba(255,153,51,0.16)',
      borderColor: isDark ? 'rgba(255,153,51,0.5)' : 'rgba(251,146,60,0.42)',
    },
    assignPillText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
    assignPillTextActive: { color: isDark ? '#FFEDD4' : '#9a3412' },

    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 40, backgroundColor: colors.background, borderTopWidth: 1, borderColor: hairline },

    payCta: { marginTop: 16, backgroundColor: colors.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,153,51,0.35)' },
    payCtaLabel: { color: colors.textMuted, fontWeight: '700' },
    payCtaAmount: { color: '#FF9933', fontSize: 24, fontWeight: '900', marginTop: 2 },

    sheetBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: sheetScrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.card, padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
    cancelSheet: { backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
    neverMindBtn: { marginTop: 10, backgroundColor: colors.pressableBg, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', alignSelf: 'center', borderWidth: 1, borderColor: hairline },
    neverMindBtnText: { color: colors.textSecondary, fontWeight: '800', fontSize: 13 },
    sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    sheetBody: { color: colors.textMuted, marginTop: 8 },

    memberSheet: { backgroundColor: colors.card, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, borderTopWidth: 1, borderColor: hairline },
    memberSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    memberSheetTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
    memberSheetSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2, fontWeight: '600' },
    memberSheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.iconTileBg },
    memberSheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: hairline },
    memberSheetItemName: { color: colors.text, fontSize: 14, fontWeight: '700' },
    memberSheetNote: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    memberSheetPrice: { color: '#FF9933', fontSize: 14, fontWeight: '800' },

    successBadgeWrapper: { width: 72, height: 72, marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
    successBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,153,51,0.12)', alignItems: 'center', justifyContent: 'center' },
    cancelledBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    pulseRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: 'rgba(255,153,51,0.6)' },
    successTitle: { color: colors.text, fontWeight: '900', fontSize: 24 },
    successSubtitle: { color: colors.textMuted, textAlign: 'center', marginTop: 6 },
    receiptCard: { marginTop: 16, backgroundColor: colors.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: hairline },
    receiptLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
    receiptName: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
    receiptAmount: { color: '#FF9933', fontWeight: '800', marginTop: 4 },
    itemDetailsSheet: { backgroundColor: colors.card, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: hairline },
    itemDetailsTitle: { color: colors.text, fontWeight: '800', fontSize: 18 },
    itemDetailsImage: { width: '100%', height: 180, borderRadius: 14, backgroundColor: colors.pressableBg },
    itemDetailsName: { color: colors.text, fontWeight: '800', fontSize: 20, marginTop: 12 },
    itemDetailsDesc: { color: colors.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },
    itemDetailsPrice: { color: '#FF9933', fontSize: 24, fontWeight: '900' },
  });
}

const JoinPartyStylesContext = createContext<ReturnType<typeof createJoinPartyStyles> | null>(null);

function useJoinS() {
  const v = useContext(JoinPartyStylesContext);
  if (!v) throw new Error('useJoinS must be used within JoinPartyScreen');
  return v;
}

type MenuItem = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_vegetarian: boolean;
  is_spicy: boolean | null;
  category: string | null;
  meal_times?: string[] | null;
  in_stock: boolean;
  stripe_tax_code?: string;
};

type Restaurant = { id: number; name: string; image_url: string | null; sales_tax_rate_bps?: number | null };

/**
 * Apple Pay / Google Pay show a "save card to this device?" sheet *after*
 * the merchant flow has redirected back into the app. If we surface our own
 * Alert.alert / haptics the instant the deep link lands, the system pulls
 * focus back to us and the wallet sheet vanishes. Defer our reactions by
 * just under a second so the wallet sheet keeps the foreground.
 */
const WALLET_INTERACTION_GRACE_MS = 900;
const HOME_GROUP_NOTICE_KEY = "rasvia_home_group_notice_v1";

/** Drop home-screen banner cache when it points at this session (guest leave / cancel). */
async function clearHomeActiveGroupOrderCache(userId: string | undefined, sid: string) {
  if (!userId || !sid) return;
  try {
    const k = `rasvia_active_group_order_${userId}`;
    const raw = await SecureStore.getItemAsync(k);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { sessionId?: string };
    if (String(parsed?.sessionId ?? '') === sid) {
      await SecureStore.deleteItemAsync(k);
    }
  } catch {
    /* ignore */
  }
}

async function queueHomeGroupNotice(payload: { type: "left_group"; restaurantName?: string | null; sessionId: string }) {
  try {
    await SecureStore.setItemAsync(
      HOME_GROUP_NOTICE_KEY,
      JSON.stringify({
        type: payload.type,
        restaurantName: payload.restaurantName ?? "the group order",
        sessionId: payload.sessionId,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    // non-blocking
  }
}

const PAYMENT_MODES: { key: PaymentMode; title: string; subtitle: string }[] = [
  { key: 'host_pays',   title: 'Host covers everyone', subtitle: 'You pay the whole bill.' },
  { key: 'equal_split', title: 'Split evenly',         subtitle: 'Everyone pays the same share.' },
  { key: 'per_person',  title: 'Each pays their own',  subtitle: 'You pay for the items you added.' },
  { key: 'assigned',    title: 'Host decides',         subtitle: 'You choose who pays for each item.' },
];

export default function JoinPartyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; checkout_status?: string; reason?: string }>();
  const sessionId = String(params.id || '').trim();
  const { session: authSession } = useAuth();
  const { addEvent } = useNotifications();

  const [creds, setCreds] = useState<PartyCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Name entry
  const [nameInput, setNameInput] = useState('');
  const [joining, setJoining] = useState(false);

  // UI state
  const [view, setView] = useState<'browse' | 'review' | 'pay' | 'success'>('browse');
  const [busy, setBusy] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuTags, setMenuTags] = useState<MenuTagConfig[]>(DEFAULT_MENU_TAGS);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
  const [selectedMenuItem, setSelectedMenuItem] = useState<MenuItem | null>(null);
  /** Optimistic +1 overlay for the menu Add buttons, keyed by menu_item_id.
   *  Cleared on snapshot refresh so the badge reflects the tap instantly
   *  without waiting for the Supabase RPC round-trip. */
  const [pendingAdds, setPendingAdds] = useState<Record<number, number>>({});

  const session = snapshot?.session ?? null;
  const members = snapshot?.members ?? [];
  const items = snapshot?.items ?? [];
  const payments = snapshot?.payments ?? [];
  const me = creds ? members.find((m) => m.id === creds.memberId) ?? null : null;
  const isHost = me?.role === 'host';
  const myPayment = creds ? paymentForMember(payments, creds.memberId) : null;
  const hostInReview = session?.host_in_review === true;
  const nonHostCartLocked = !isHost && hostInReview;

  const showCartLockAlert = useCallback(() => {
    Alert.alert(
      'Cart locked',
      'Cart locked. Host is currently deciding how the bill should be paid.',
    );
  }, []);

  const hapticTap = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // NOTE: All hooks (useState/useEffect/useMemo/useCallback) must be called
  // unconditionally BEFORE any early-return branches below. The filtered-menu
  // memo in particular was previously invoked from JSX in the browse stage,
  // which made the hook count change between renders (e.g. loading vs browse).
  const itemMatchesTag = useCallback((item: MenuItem, tagKey: string) => {
    const available = menuTags.filter((t) => t.enabled);
    const normalized = normalizeMenuItemTags(item.meal_times ?? [], available);
    if (normalized.includes(tagKey)) return true;
    const categoryKey = String(item.category ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return categoryKey === tagKey;
  }, [menuTags]);

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((m) => {
      if (categoryFilter && !itemMatchesTag(m, categoryFilter)) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q);
    });
  }, [menu, search, categoryFilter, itemMatchesTag]);

  const { colors, isDark } = useAppTheme();
  const joinS = useMemo(() => createJoinPartyStyles(colors, isDark), [colors, isDark]);
  const wrapJoin = (ui: ReactElement) => (
    // The join page is the "user clicked through to a specific restaurant"
    // entry point via a deep link, so it's one of the screens allowed to
    // hit the image server and populate the disk cache.
    <ImageFetchProvider allowFetch={true}>
      <JoinPartyStylesContext.Provider value={joinS}>{ui}</JoinPartyStylesContext.Provider>
    </ImageFetchProvider>
  );

  // Derived view based on session status
  useEffect(() => {
    if (!session) return;
    if (session.status === 'submitted' || session.status === 'completed') {
      setView('success');
      return;
    }
    if (session.status === 'cancelled') {
      setView('browse');
      return;
    }
    if (session.status === 'locked' || session.status === 'paying') {
      setView('pay');
      return;
    }
    // session.status === 'open'
    setView((prev) => (prev === 'review' ? 'review' : 'browse'));
  }, [session?.status]);

  // Load saved credentials once we have sessionId. `credsLoaded` flips once
  // we know whether the device has any saved creds — we gate the name-entry
  // screen on this so returning users don't flicker through the name prompt.
  useEffect(() => {
    if (!sessionId) { setCredsLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const saved = await loadPartyCreds(sessionId);
      if (cancelled) return;
      if (saved) {
        setCreds(saved);
        // Make sure the active index stays in sync with what's on disk; if
        // we have cached creds, we're actively in the session.
        void addActiveParty(sessionId);
      }
      setCredsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Pre-fill nameInput from the signed-in user's profile — prefer
  // `first_name + last_name` when both are available, otherwise any stored
  // full/display name. We deliberately do NOT fall back to a device-cached
  // "last display name" here: that key is shared across whichever Rasvia
  // account happens to be signed in on this phone, so leaking a previous
  // user's name would be a privacy hazard. If no profile name is available,
  // the field stays blank and the guest types their own name.
  useEffect(() => {
    if (nameInput.trim().length > 0) return;
    let cancelled = false;
    (async () => {
      const meta: any = authSession?.user?.user_metadata ?? {};
      const metaFirst = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
      const metaLast = typeof meta.last_name === 'string' ? meta.last_name.trim() : '';
      let candidate = [metaFirst, metaLast].filter(Boolean).join(' ').trim();
      if (!candidate) {
        candidate = (
          (typeof meta.full_name === 'string' ? meta.full_name : '') ||
          (typeof meta.name === 'string' ? meta.name : '') ||
          (typeof meta.display_name === 'string' ? meta.display_name : '')
        ).trim();
      }
      if (!candidate && authSession?.user?.id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('first_name, last_name, full_name, display_name')
            .eq('id', authSession.user.id)
            .maybeSingle();
          const p: any = data ?? {};
          const first = typeof p.first_name === 'string' ? p.first_name.trim() : '';
          const last = typeof p.last_name === 'string' ? p.last_name.trim() : '';
          candidate = [first, last].filter(Boolean).join(' ')
            || (typeof p.full_name === 'string' ? p.full_name.trim() : '')
            || (typeof p.display_name === 'string' ? p.display_name.trim() : '');
        } catch {
          // ignore — stay blank
        }
      }
      if (cancelled) return;
      if (candidate) setNameInput(candidate);
    })();
    return () => { cancelled = true; };
  }, [authSession?.user?.id]);

  // Fetch initial snapshot + menu
  const loadAll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const snap = await fetchSnapshot(supabase, sessionId);
      setSnapshot(snap);
      setPendingAdds({});
      if (!restaurant || restaurant.id !== snap.session.restaurant_id) {
        const { data: rest } = await supabase
          .from('restaurants')
          .select('id, name, image_url, sales_tax_rate_bps')
          .eq('id', snap.session.restaurant_id)
          .maybeSingle();
        if (rest) setRestaurant(rest as Restaurant);
        const { data: menuRows } = await supabase
          .from('menu_items')
          .select('id, name, description, price, image_url, is_vegetarian, is_spicy, category, meal_times, in_stock, stripe_tax_code')
          .eq('restaurant_id', snap.session.restaurant_id)
          .eq('in_stock', true)
          .order('category', { ascending: true })
          .order('name', { ascending: true });
        const items = (menuRows ?? []) as MenuItem[];
        setMenu(items);
        // The join page counts as "clicking through to a restaurant" for
        // the caching policy, so warm the disk cache for every menu image.
        void prefetchImages([(rest as any)?.image_url, ...items.map((m) => m.image_url)]);
        const { data: rawTags } = await supabase
          .from('restaurant_menu_tags')
          .select('key, label, color, bg, border, enabled, position')
          .eq('restaurant_id', snap.session.restaurant_id)
          .order('position', { ascending: true });
        setMenuTags(parseRestaurantMenuTags(rawTags));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load group order.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, restaurant]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime subscription
  useEffect(() => {
    if (!sessionId) return;
    const handle = subscribeToParty(
      supabase,
      sessionId,
      (snap) => { setSnapshot(snap); setPendingAdds({}); },
      (err) => console.warn('Party realtime error:', err.message),
    );
    return () => handle.unsubscribe();
  }, [sessionId]);

  // Handle checkout return (from payment-redirect deep link).
  //
  // Apple Pay / Google Pay can render a "save this card to your device?"
  // sheet on top of the redirect. If we fire haptics or an Alert.alert the
  // instant the deep link lands, the system pops the focus to that alert
  // and the wallet sheet vanishes before the user can tap on it. Delay our
  // own UI by ~WALLET_INTERACTION_GRACE_MS so the wallet sheet wins focus.
  useEffect(() => {
    const status = params.checkout_status;
    if (!status) return;
    const t = setTimeout(() => {
      if (status === 'success') {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (status === 'cancel') {
        Alert.alert('Payment cancelled', 'You can try again when you are ready.');
      } else if (status === 'error') {
        Alert.alert('Payment issue', params.reason === 'payment_mismatch' ? 'Payment amount mismatch detected.' : 'We could not verify the payment. Please try again.');
      }
    }, WALLET_INTERACTION_GRACE_MS);
    return () => clearTimeout(t);
  }, [params.checkout_status, params.reason]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    hapticTap();
    const name = nameInput.trim();
    if (!name) { Alert.alert('Enter your name', 'Please enter your name to continue.'); return; }
    setJoining(true);
    try {
      const existing = await loadPartyCreds(sessionId);
      const result = await joinSession(supabase, sessionId, name);
      const next = await completeJoinCredentials(supabase, sessionId, result, existing);
      setCreds(next);
      await savePartyCreds(next);
      // Record in the device-local active-party index so the home screen can
      // offer a "rejoin" tab if the user navigates away.
      await addActiveParty(sessionId);
      await loadAll();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Join failed', err instanceof Error ? err.message : 'Unable to join group.');
    } finally {
      setJoining(false);
    }
  };

  const recoverCredsAfterUnauthorized = useCallback(
    async (memberId: string): Promise<PartyCreds | null> => {
      if (!sessionId) return null;
      const rotated = await reissuePartyMemberToken(supabase, sessionId);
      if (rotated) {
        await savePartyCreds(rotated);
        setCreds(rotated);
        return rotated;
      }
      const displayName =
        snapshot?.members.find((x) => x.id === memberId)?.display_name?.trim() || nameInput.trim();
      if (!displayName) return null;
      try {
        const existing = await loadPartyCreds(sessionId);
        const jr = await joinSession(supabase, sessionId, displayName);
        const next = await completeJoinCredentials(supabase, sessionId, jr, existing);
        await savePartyCreds(next);
        setCreds(next);
        return next;
      } catch {
        return null;
      }
    },
    [sessionId, snapshot?.members, nameInput],
  );

  const handleAddItem = async (menuItemId: number) => {
    if (!creds) return;
    if (nonHostCartLocked) {
      showCartLockAlert();
      return;
    }
    // Optimistic +1 so the badge reacts instantly — the real snapshot will
    // replace this within a few hundred ms via realtime.
    setPendingAdds((prev) => ({ ...prev, [menuItemId]: (prev[menuItemId] ?? 0) + 1 }));
    hapticTap();
    try {
      await addItem(supabase, creds, menuItemId, 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (isPartyUnauthorizedMessage(msg)) {
        const fresh = await recoverCredsAfterUnauthorized(creds.memberId);
        if (fresh) {
          try {
            await addItem(supabase, fresh, menuItemId, 1);
            return;
          } catch {
            /* fall through to revert + alert */
          }
        }
      }
      setPendingAdds((prev) => {
        const next = { ...prev };
        const current = next[menuItemId] ?? 0;
        if (current <= 1) delete next[menuItemId]; else next[menuItemId] = current - 1;
        return next;
      });
      Alert.alert('Could not add item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleChangeQty = async (item: PartyItem, delta: number) => {
    if (!creds) return;
    if (nonHostCartLocked) {
      showCartLockAlert();
      return;
    }
    const nextQty = Math.max(0, (item.quantity ?? 1) + delta);
    try {
      await updateItemQuantity(supabase, creds, item.id, nextQty);
      hapticTap();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (isPartyUnauthorizedMessage(msg)) {
        const fresh = await recoverCredsAfterUnauthorized(creds.memberId);
        if (fresh) {
          try {
            await updateItemQuantity(supabase, fresh, item.id, nextQty);
            hapticTap();
            return;
          } catch {
            /* fall through */
          }
        }
      }
      Alert.alert('Could not update item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleRemoveItem = async (item: PartyItem) => {
    if (!creds) return;
    if (nonHostCartLocked) {
      showCartLockAlert();
      return;
    }
    try {
      await removeItem(supabase, creds, item.id);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (isPartyUnauthorizedMessage(msg)) {
        const fresh = await recoverCredsAfterUnauthorized(creds.memberId);
        if (fresh) {
          try {
            await removeItem(supabase, fresh, item.id);
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            return;
          } catch {
            /* fall through */
          }
        }
      }
      Alert.alert('Could not remove item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleSetMode = async (mode: PaymentMode) => {
    if (!creds) return;
    hapticTap();
    try {
      await setPaymentMode(supabase, creds, mode);
    } catch (err) {
      Alert.alert('Could not change mode', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleLock = async () => {
    if (!creds) return;
    hapticTap();
    if (items.length === 0) { Alert.alert('Empty cart', 'Add at least one item before checking out.'); return; }
    setBusy(true);
    try {
      const nextSnap = await lockSession(supabase, creds);
      setSnapshot(nextSnap);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not lock cart', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (!creds) return;
    hapticTap();
    setBusy(true);
    try { await unlockSession(supabase, creds); }
    catch (err) { Alert.alert('Could not unlock', err instanceof Error ? err.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const openStripeCheckout = async (url: string) => {
    if (Platform.OS === 'web') {
      window.location.href = url;
      return;
    }
    const redirectUrl = Linking.createURL(`/join/${sessionId}`);
    try {
      await WebBrowser.openAuthSessionAsync(url, redirectUrl, { showInRecents: true });
    } catch {
      Alert.alert('Unable to open checkout', 'Please try again.');
    }
  };

  const handlePayMyShare = async () => {
    if (!creds) return;
    hapticTap();
    if (!myPayment || myPayment.amount_cents <= 0) return;
    setBusy(true);
    try {
      const { url } = await startCheckout(supabase, creds, {
        returnUrlBase: Linking.createURL(`/join/${sessionId}`),
      });
      await openStripeCheckout(url);
    } catch (err) {
      const title = err instanceof CheckoutError && err.title ? err.title : 'Checkout failed';
      Alert.alert(title, err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleCoverMember = async (memberId: string) => {
    if (!creds) return;
    hapticTap();
    const target = members.find((m) => m.id === memberId);
    if (!target) return;
    Alert.alert(
      `Pay for ${target.display_name}?`,
      'You will be charged their share on your card.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            setBusy(true);
            try {
              const { url } = await startCheckout(supabase, creds, {
                coverMemberId: memberId,
                returnUrlBase: Linking.createURL(`/join/${sessionId}`),
              });
              await openStripeCheckout(url);
            } catch (err) {
              const title = err instanceof CheckoutError && err.title ? err.title : 'Checkout failed';
              Alert.alert(title, err instanceof Error ? err.message : 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleCancelSession = async () => {
    if (!creds) return;
    hapticTap();
    setBusy(true);
    try {
      const result = await cancelSession(supabase, creds);
      const rid = restaurant?.id ?? snapshot?.session.restaurant_id;
      const rname = restaurant?.name ?? 'Restaurant';
      void addEvent({
        type: 'group_cancelled',
        restaurantName: rname,
        restaurantId: rid != null ? String(rid) : '',
        entryId: sessionId,
        partySize: members.length,
        timestamp: new Date().toISOString(),
        metadata: { refunded: result.refunded, failed: result.failed },
      });
      Alert.alert('Group order cancelled', `${result.refunded} payment${result.refunded === 1 ? '' : 's'} refunded.`);
      await clearPartyCreds(sessionId);
      await removeActiveParty(sessionId);
      await clearHomeActiveGroupOrderCache(authSession?.user?.id, sessionId);
      router.back();
    } catch (err) {
      Alert.alert('Cancel failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
      setShowCancelConfirm(false);
    }
  };

  const handleLeave = async () => {
    if (!creds) return;
    hapticTap();
    Alert.alert(
      'Leave group order?',
      'Your items (if any) will be removed if the cart is still open.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try { await leaveSession(supabase, creds); } catch { /* ignore */ }
            await queueHomeGroupNotice({
              type: "left_group",
              restaurantName: restaurant?.name ?? "the group order",
              sessionId,
            });
            await clearPartyCreds(sessionId);
            await removeActiveParty(sessionId);
            await clearHomeActiveGroupOrderCache(authSession?.user?.id, sessionId);
            router.replace('/');
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    hapticTap();
    const url = `https://rasvia.com/join?id=${sessionId}`;
    try {
      if (Platform.OS === 'web') await Clipboard.setStringAsync(url);
      else await Share.share({ message: `Join my Rasvia group order: ${url}`, url });
    } catch { /* ignore */ }
  };

  // ── Loading / error early returns ───────────────────────────────────────
  if (!sessionId) {
    return wrapJoin(
      <View style={joinS.centered}>
        <Text style={joinS.errorText}>Missing session id.</Text>
      </View>
    );
  }
  // Wait for BOTH the initial snapshot load AND the saved-creds read before
  // deciding whether to show the name-entry screen. Otherwise a returning
  // guest sees a brief flicker of the name prompt before being switched to
  // the browse view once creds resolve.
  if (loading || !credsLoaded) {
    return wrapJoin(
      <View style={joinS.centered}>
        <ActivityIndicator color="#FF9933" />
      </View>
    );
  }
  if (errorMsg) {
    return wrapJoin(
      <View style={joinS.centered}>
        <AlertCircle size={32} color="#EF4444" />
        <Text style={joinS.errorText}>{errorMsg}</Text>
        <Pressable onPress={() => { setErrorMsg(null); loadAll(); }} style={joinS.retryBtn}>
          <Text style={joinS.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!session) {
    return wrapJoin(
      <View style={joinS.centered}>
        <Text style={joinS.errorText}>Group order not found.</Text>
      </View>
    );
  }

  // ── Cancelled session kicks everyone out ────────────────────────────────
  if (session.status === 'cancelled') {
    return wrapJoin(
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={joinS.centered}>
          <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 10, maxWidth: 340 }}>
            <View style={joinS.cancelledBadge}><X size={32} color="#EF4444" strokeWidth={3} /></View>
            <Text style={joinS.successTitle}>Group order ended</Text>
            <Text style={joinS.successSubtitle}>
              {restaurant?.name ? `The host cancelled the group order at ${restaurant.name}.` : 'The host cancelled this group order.'}
              {' '}Any paid shares have been refunded.
            </Text>
            <Pressable
              onPress={async () => {
                await clearPartyCreds(sessionId);
                await removeActiveParty(sessionId);
                await clearHomeActiveGroupOrderCache(authSession?.user?.id, sessionId);
                router.replace('/');
              }}
              style={[joinS.primaryBtn, { marginTop: 10, alignSelf: 'stretch' }]}
            >
              <Text style={joinS.primaryBtnText}>Back to home</Text>
            </Pressable>
          </Animated.View>
        </View>
      </>
    );
  }

  // ── Name entry ──────────────────────────────────────────────────────────
  if (!creds || !me) {
    const hasPrefill = nameInput.trim().length > 0;
    return wrapJoin(
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={joinS.joinContainer}>
          <Animated.View entering={FadeIn} style={joinS.joinCard}>
            <View style={joinS.joinBadge}>
              <Users size={14} color="#FF9933" />
              <Text style={joinS.joinBadgeText}>Group order</Text>
            </View>
            <Text style={joinS.joinTitle}>Join at {restaurant?.name ?? 'this restaurant'}</Text>
            <Text style={joinS.joinSubtitle}>Your name shows up on the order so everyone knows who added what.</Text>
            <TextInput
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              style={joinS.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus={!hasPrefill}
              selectTextOnFocus
              maxLength={60}
              returnKeyType="go"
              onSubmitEditing={handleJoin}
            />
            <Pressable onPress={handleJoin} disabled={joining} style={[joinS.primaryBtn, joining && { opacity: 0.6 }]}>
              {joining ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={joinS.primaryBtnText}>{hasPrefill ? `Continue as ${nameInput.trim()}` : 'Join'}</Text>
              )}
            </Pressable>
            <Pressable onPress={() => { hapticTap(); router.back(); }} style={joinS.joinNotNowBtn}>
              <Text style={joinS.joinNotNowText}>Not now</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </>
    );
  }

  // ── Success stage ───────────────────────────────────────────────────────
  if (view === 'success' && (session.status === 'submitted' || session.status === 'completed')) {
    return wrapJoin(
      <SuccessScreen
        snapshot={snapshot!}
        restaurant={restaurant}
        creds={creds}
        onDone={async () => {
          await clearPartyCreds(sessionId);
          await removeActiveParty(sessionId);
          await clearHomeActiveGroupOrderCache(authSession?.user?.id, sessionId);
          router.replace('/');
        }}
      />
    );
  }

  // ── Pay & Wait stage ────────────────────────────────────────────────────
  if (view === 'pay' && (session.status === 'locked' || session.status === 'paying')) {
    return wrapJoin(
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={joinS.container}>
          <TopBar
            title={restaurant?.name ?? 'Group order'}
            subtitle={session.status === 'paying' ? 'Collecting payments' : 'Ready to pay'}
            onBack={() => router.back()}
          />
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            <Animated.View entering={FadeInDown} style={joinS.headerCard}>
              <Text style={joinS.summaryLabel}>Order summary</Text>
              <View style={{ marginTop: 4 }}>
                <TaxEstimateLine
                  subtotalDollars={(session.subtotal_cents ?? 0) / 100}
                  taxCents={session.tax_cents ?? null}
                  showSubtotal
                  showTotal
                  totalHero
                />
              </View>
              <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Lock size={12} color={colors.textMuted} />
                <Text style={joinS.summaryMeta}>{members.length} {members.length === 1 ? 'member' : 'members'} · {items.length} {items.length === 1 ? 'item' : 'items'}</Text>
              </View>
            </Animated.View>

            <View style={{ marginTop: 16 }}>
              <PartyLedger
                members={members}
                payments={payments}
                selfMemberId={creds.memberId}
                isHost={isHost}
                orderSubtotalCents={session.subtotal_cents ?? 0}
                orderTaxCents={session.tax_cents ?? 0}
                items={items}
                paymentMode={session.payment_mode}
                staffManaged={session.staff_managed}
                onCoverMember={handleCoverMember}
                onRetry={handlePayMyShare}
                onMemberTap={(id) => {
                  hapticTap();
                  setViewingMemberId(id);
                }}
              />
            </View>

            {myPayment && myPayment.amount_cents > 0 && myPayment.status !== 'paid' && myPayment.status !== 'covered' ? (
              <Animated.View entering={FadeInDown.delay(150)} style={joinS.payCta}>
                <Text style={joinS.payCtaLabel}>Your share</Text>
                <Text style={joinS.payCtaAmount}>{formatCents(myPayment.amount_cents)}</Text>
                <Pressable onPress={handlePayMyShare} disabled={busy} style={[joinS.primaryBtn, { marginTop: 8 }, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color="#ffffff" /> : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <CreditCard size={18} color="#ffffff" />
                      <Text style={joinS.primaryBtnText}>Pay now</Text>
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            ) : myPayment && (myPayment.status === 'paid' || myPayment.status === 'covered') ? (
              <Animated.View entering={FadeInDown.delay(150)} style={[joinS.payCta, { borderColor: 'rgba(34,197,94,0.35)' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Check size={18} color="#22C55E" />
                  <Text style={[joinS.payCtaLabel, { color: '#22C55E' }]}>Your share is paid</Text>
                </View>
              </Animated.View>
            ) : null}

            {isHost ? (
              <View style={{ marginTop: 20, gap: 8 }}>
                {session.status === 'locked' && !payments.some(
                  (p) =>
                    p.status === 'paid' ||
                    (p.status === 'covered' && (p.covered_by_member_id != null || p.amount_cents > 0)),
                ) ? (
                  <Pressable onPress={handleUnlock} disabled={busy} style={joinS.secondaryBtn}>
                    <Unlock size={16} color={colors.textMuted} />
                    <Text style={joinS.secondaryBtnText}>Back to editing</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => { hapticTap(); setShowCancelConfirm(true); }} disabled={busy} style={joinS.dangerBtn}>
                  <X size={16} color="#EF4444" />
                  <Text style={joinS.dangerBtnText}>Cancel group order</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          <CancelSheet visible={showCancelConfirm} onCancel={() => setShowCancelConfirm(false)} onConfirm={handleCancelSession} busy={busy} />

          <MemberItemsSheet
            visible={viewingMemberId !== null}
            member={members.find((m) => m.id === viewingMemberId) ?? null}
            memberIndex={Math.max(0, members.findIndex((m) => m.id === viewingMemberId))}
            items={items.filter((it) => it.added_by_member_id === viewingMemberId)}
            isSelf={viewingMemberId === creds.memberId}
            onClose={() => setViewingMemberId(null)}
          />
        </View>
      </>
    );
  }

  // ── Review & Split stage (host-only overlay on top of browse) ───────────
  if (view === 'review' && session.status === 'open') {
    return wrapJoin(
      <ReviewStage
        sessionId={sessionId}
        snapshot={snapshot!}
        restaurant={restaurant}
        creds={creds}
        onBack={() => setView('browse')}
        onAssignPayer={async (itemId, payerId) => {
          try { await assignItemPayer(supabase, creds, itemId, payerId); }
          catch (err) { Alert.alert('Could not assign', err instanceof Error ? err.message : 'Try again.'); }
        }}
        onSetSplit={async (itemId, memberIds) => {
          try { await setItemSplit(supabase, creds, itemId, memberIds); }
          catch (err) { Alert.alert('Could not set split', err instanceof Error ? err.message : 'Try again.'); }
        }}
        onSetMode={handleSetMode}
        onLock={handleLock}
        busy={busy}
      />
    );
  }

  // ── Tableside (staff-managed) — guests can't add items themselves; the
  //    waiter takes the order on their dashboard and assigns items to each
  //    guest. We show a compact roster + personal check view instead of
  //    the full browse/menu UI.
  if (session.staff_managed && !isHost) {
    const myItems = items.filter((it) => it.added_by_member_id === creds.memberId);
    const mySubtotal = myItems.reduce(
      (sum, it) => sum + Math.round(Number(it.menu_item?.price ?? 0) * 100) * Math.max(1, it.quantity),
      0,
    );
    return wrapJoin(
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={joinS.container}>
          <TopBar
            title={restaurant?.name ?? 'Tableside'}
            subtitle={`${members.length} at the table · waiter is taking the order`}
            onBack={() => router.back()}
          />
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
            <Animated.View entering={FadeInDown} style={[joinS.headerCard, { backgroundColor: 'rgba(255,153,51,0.08)', borderColor: 'rgba(255,153,51,0.3)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <PartyPopper size={14} color="#FF9933" />
                <Text style={{ color: '#FF9933', fontWeight: '800', fontSize: 13 }}>You're on the table</Text>
              </View>
              <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 13, lineHeight: 19 }}>
                Just tell your server what you'd like — they'll add it to your check from their tablet. When the waiter locks the cart, your "Pay my share" button will appear here.
              </Text>
            </Animated.View>

            <View style={{ marginTop: 16 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>At the table</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 10, alignItems: 'center' }}>
                {members.map((m, idx) => (
                  <MemberChip
                    key={m.id}
                    member={m}
                    index={idx}
                    isSelf={m.id === creds.memberId}
                    itemCount={items.filter((it) => it.added_by_member_id === m.id).reduce((sum, it) => sum + (it.quantity ?? 1), 0)}
                    onPress={() => setViewingMemberId(m.id)}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>Subtotal</Text>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{formatCents(mySubtotal)}</Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                + est. tax {formatCentsUsd(estimatedTaxCentsFromCents(mySubtotal, restaurant?.sales_tax_rate_bps))}. Final at payment.
              </Text>
              {myItems.length === 0 ? (
                <View style={{ marginTop: 10, paddingVertical: 18, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.cardBorder, alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>
                    Nothing on your check yet — flag down your server and they'll add it here.
                  </Text>
                </View>
              ) : (
                <View style={{ marginTop: 10, gap: 8 }}>
                  {myItems.map((it) => (
                    <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                          {it.menu_item?.name ?? 'Item'}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
                        </Text>
                        {it.special_requests ? (
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontStyle: 'italic', marginTop: 2 }} numberOfLines={1}>"{it.special_requests}"</Text>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                        {formatCents(Math.round(Number(it.menu_item?.price ?? 0) * 100) * Math.max(1, it.quantity))}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <MemberItemsSheet
            visible={viewingMemberId !== null}
            member={members.find((m) => m.id === viewingMemberId) ?? null}
            memberIndex={Math.max(0, members.findIndex((m) => m.id === viewingMemberId))}
            items={items.filter((it) => it.added_by_member_id === viewingMemberId)}
            isSelf={viewingMemberId === creds.memberId}
            onClose={() => setViewingMemberId(null)}
          />
        </View>
      </>
    );
  }

  // ── Browse & Add stage (default) ────────────────────────────────────────
  return wrapJoin(
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={joinS.container}>
        <TopBar
          title={restaurant?.name ?? 'Group order'}
          subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · ${items.length} item${items.length === 1 ? '' : 's'}`}
          rightIcon="share"
          onBack={() => router.back()}
          onRight={handleShare}
        />

        {/* Members strip — tap a member to see what they've ordered */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={joinS.membersStrip} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 6, gap: 10, alignItems: 'center' }}>
          {members.map((m, idx) => (
            <MemberChip
              key={m.id}
              member={m}
              index={idx}
              isSelf={m.id === creds.memberId}
              itemCount={items.filter((it) => it.added_by_member_id === m.id).reduce((sum, it) => sum + (it.quantity ?? 1), 0)}
              onPress={() => setViewingMemberId(m.id)}
            />
          ))}
        </ScrollView>

        {/* Search bar */}
        <View style={joinS.searchBar}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            placeholder="Search menu"
            placeholderTextColor={colors.textMuted}
            style={joinS.searchInput}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Categories */}
        <CategoryChips tags={menuTags} active={categoryFilter} onChange={setCategoryFilter} />

        {/* Menu list */}
        <FlatList
          style={{ flex: 1 }}
          data={filteredMenu}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 180, flexGrow: 1 }}
          renderItem={({ item }) => (
            <MenuRow
              item={item}
              inCartCount={cartCountFor(items, item.id) + (pendingAdds[Number(item.id)] ?? 0)}
              onAdd={() => handleAddItem(item.id)}
              onOpenDetails={() => {
                hapticTap();
                setSelectedMenuItem(item);
              }}
              cartLocked={nonHostCartLocked}
              onCartLocked={showCartLockAlert}
            />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 56, gap: 6 }}>
              <Search size={24} color={colors.iconMuted} />
              <Text style={{ color: colors.textMuted, fontWeight: '600', fontSize: 13 }}>Nothing matches that filter.</Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>Try clearing the search or category.</Text>
            </View>
          }
        />

        {/* Cart summary strip */}
        <CartSummary
          items={items}
          members={members}
          selfMemberId={creds.memberId}
          onReview={isHost ? () => setView('review') : undefined}
          onRemove={handleRemoveItem}
          onChangeQty={handleChangeQty}
          canEdit={true}
          isHost={isHost}
          hostDeciding={hostInReview}
          guestCartLocked={nonHostCartLocked}
          restaurantId={restaurant?.id}
          onLeave={handleLeave}
        />

        <MemberItemsSheet
          visible={viewingMemberId !== null}
          member={members.find((m) => m.id === viewingMemberId) ?? null}
          memberIndex={Math.max(0, members.findIndex((m) => m.id === viewingMemberId))}
          items={items.filter((it) => it.added_by_member_id === viewingMemberId)}
          isSelf={viewingMemberId === creds.memberId}
          onClose={() => setViewingMemberId(null)}
        />
        <MenuItemDetailsModal
          item={selectedMenuItem}
          onClose={() => setSelectedMenuItem(null)}
          onAdd={() => selectedMenuItem ? handleAddItem(selectedMenuItem.id) : undefined}
          menuTags={menuTags}
          cartLocked={nonHostCartLocked}
          onCartLocked={showCartLockAlert}
        />
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function TopBar({ title, subtitle, onBack, rightIcon, onRight }: { title: string; subtitle?: string; onBack?: () => void; rightIcon?: 'share' | 'close'; onRight?: () => void }) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  return (
    <View style={s.topBar}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onBack?.();
        }}
        hitSlop={12}
      >
        <ArrowLeft size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text style={s.topTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.topSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onRight && rightIcon === 'share' ? (
        <Pressable
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRight();
          }}
          hitSlop={12}
        >
          <Share2 size={20} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

function MemberChip({
  member, index, isSelf, itemCount = 0, onPress,
}: {
  member: PartyMember; index: number; isSelf: boolean; itemCount?: number; onPress?: () => void;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  const color = colorForMember(member.id, []);
  const fallback = ['#FF9933', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'][index % 8];
  return (
    <Pressable onPress={() => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress?.();
    }} style={[s.memberChip, isSelf && { borderColor: '#FF9933' }]}>
      <View style={[s.avatarSm, { backgroundColor: member.avatar_url ? colors.pressableBg : color || fallback, overflow: 'hidden' }]}>
        {member.avatar_url ? (
          <Image source={{ uri: member.avatar_url }} style={{ width: '100%', height: '100%' }} />
        ) : (
          <Text style={s.avatarSmText}>{memberInitials(member.display_name)}</Text>
        )}
        {member.role === 'host' ? <Crown size={10} color="#FFF" style={{ position: 'absolute', top: -2, right: -2 }} strokeWidth={3} /> : null}
      </View>
      <Text style={s.memberChipText} numberOfLines={1}>
        {isSelf ? `${member.display_name} · You` : member.display_name}
      </Text>
      {itemCount > 0 ? (
        <View style={s.memberChipCount}>
          <Text style={s.memberChipCountText}>{itemCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function CategoryChips({ tags, active, onChange }: { tags: MenuTagConfig[]; active: string | null; onChange: (v: string | null) => void }) {
  const s = useJoinS();
  const enabledTags = tags.filter((t) => t.enabled);
  if (enabledTags.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginTop: 8, height: 46, flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
    >
      <Pressable onPress={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(null);
      }} style={[s.catChip, !active && s.catChipActive]}>
        <Text numberOfLines={1} style={[s.catChipText, !active && s.catChipTextActive]}>All</Text>
      </Pressable>
      {enabledTags.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onChange(t.key === active ? null : t.key);
          }}
          style={[
            s.catChip,
            active === t.key && { backgroundColor: t.bg, borderColor: t.border },
          ]}
        >
          <Text numberOfLines={1} style={[s.catChipText, active === t.key && { color: t.color }]}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function MenuRow({
  item, inCartCount, onAdd, onOpenDetails, cartLocked, onCartLocked,
}: {
  item: MenuItem; inCartCount: number; onAdd: () => void; onOpenDetails: () => void;
  cartLocked: boolean; onCartLocked: () => void;
}) {
  const s = useJoinS();
  const { colors, isDark } = useAppTheme();
  const triggerDetails = () => {
    if (cartLocked) {
      onCartLocked();
      return;
    }
    onOpenDetails();
  };
  const triggerAdd = () => {
    if (cartLocked) {
      onCartLocked();
      return;
    }
    onAdd();
  };
  return (
    <Animated.View
      entering={FadeInDown}
      style={[
        s.menuRow,
        cartLocked && { opacity: isDark ? 0.45 : 0.5, backgroundColor: isDark ? 'rgba(15,15,15,0.5)' : 'rgba(0,0,0,0.04)' },
      ]}
    >
      <Pressable onPress={triggerDetails} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {item.image_url ? (
          <CachedImage source={{ uri: item.image_url }} style={s.menuImg} />
        ) : (
          <View style={[s.menuImg, { backgroundColor: colors.pressableBg, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: colors.textMuted }}>—</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.menuName} numberOfLines={1}>{item.name}</Text>
            {item.is_vegetarian ? <Leaf size={12} color="#22C55E" /> : null}
            {item.is_spicy ? <Flame size={12} color="#EF4444" /> : null}
          </View>
          {item.description ? <Text style={s.menuDesc} numberOfLines={2}>{item.description}</Text> : null}
          <Text style={s.menuPrice}>${Number(item.price).toFixed(2)}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={triggerAdd}
        style={[
          s.addBtn,
          cartLocked && { backgroundColor: colors.cardBorder, opacity: 0.9 },
        ]}
        disabled={false}
      >
        <Plus size={16} color={cartLocked ? colors.textMuted : '#ffffff'} strokeWidth={3} />
        {inCartCount > 0 ? <Text style={s.addBtnCount}>{inCartCount}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

function MenuItemDetailsModal({
  item,
  onClose,
  onAdd,
  menuTags,
  cartLocked,
  onCartLocked,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onAdd: () => void;
  menuTags: MenuTagConfig[];
  cartLocked: boolean;
  onCartLocked: () => void;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!item) return null;
  const tags = normalizeMenuItemTags(item.meal_times ?? [], menuTags.filter((t) => t.enabled));
  const tagMap = new Map(menuTags.map((t) => [t.key, t]));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.itemDetailsSheet, { marginBottom: Math.max(12, insets.bottom + 8) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={s.itemDetailsTitle}>Item details</Text>
            <Pressable onPress={onClose} style={s.memberSheetClose}>
              <X size={18} color={colors.iconMuted} />
            </Pressable>
          </View>
          {item.image_url ? (
            <CachedImage source={{ uri: item.image_url }} style={s.itemDetailsImage} />
          ) : (
            <View style={[s.itemDetailsImage, { backgroundColor: colors.pressableBg, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.textMuted }}>No image</Text>
            </View>
          )}
          <Text style={s.itemDetailsName}>{item.name}</Text>
          {!!item.description && <Text style={s.itemDetailsDesc}>{item.description}</Text>}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {tags.map((k) => {
              const t = tagMap.get(k);
              if (!t) return null;
              return (
                <View key={k} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
                  <Text style={{ color: t.color, fontSize: 12, fontWeight: '700' }}>{t.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.itemDetailsPrice}>${Number(item.price).toFixed(2)}</Text>
            <Pressable
              onPress={() => {
                if (cartLocked) {
                  onCartLocked();
                  return;
                }
                onAdd();
              }}
              style={[
                s.primaryBtn,
                { paddingHorizontal: 18, paddingVertical: 12 },
                cartLocked && { opacity: 0.55, backgroundColor: colors.cardBorder },
              ]}
            >
              <Text style={s.primaryBtnText}>{cartLocked ? 'Cart locked' : 'Add to cart'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CartSummary(props: {
  items: PartyItem[];
  members: PartyMember[];
  selfMemberId: string;
  canEdit: boolean;
  isHost: boolean;
  /** When true, non-hosts see copy that the host is picking a payment mode. */
  hostDeciding?: boolean;
  /** When true, non-hosts cannot change line items they would normally edit. */
  guestCartLocked?: boolean;
  restaurantId?: number;
  onReview?: () => void;
  onRemove: (item: PartyItem) => void;
  onChangeQty: (item: PartyItem, delta: number) => void;
  onLeave: () => void;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const total = totalCartCents(props.items);
  const taxItems = useMemo(() => props.items.map(it => ({
    price_cents: Math.round(Number(it.menu_item?.price ?? 0) * 100),
    quantity: it.quantity ?? 1,
    stripe_tax_code: it.menu_item?.stripe_tax_code ?? "txcd_40060003",
  })), [props.items]);
  const { taxCents, loading: taxLoading } = useCartTax(props.restaurantId ?? -1, taxItems);
  const guestLock = props.guestCartLocked === true;
  const confirmRemove = useCallback((it: PartyItem) => {
    Alert.alert(
      "Remove item",
      `Remove ${it.menu_item?.name ?? "this item"} from the cart?`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => props.onRemove(it),
        },
      ],
    );
  }, [props]);

  return (
    <View style={s.cartContainer}>
      <Pressable onPress={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setOpen((v) => !v);
      }} style={s.cartHeader}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ShoppingCart size={18} color="#FF9933" />
            <Text style={s.cartTitle}>{props.items.length} item{props.items.length === 1 ? '' : 's'}</Text>
            <Text style={s.cartTotal}>{formatCents(total)}</Text>
          </View>
          <View style={{ marginTop: 6, paddingLeft: 28, paddingRight: 2 }}>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
              {taxCents !== null 
                ? `+ ${formatCentsUsd(taxCents)} tax` 
                : taxLoading ? '+ calculating tax...' : '+ tax'}
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.iconMuted} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          {props.items.length === 0 ? (
            <Text style={{ color: colors.textMuted, paddingVertical: 14 }}>No items yet. Add something from the menu above.</Text>
          ) : (
            props.items.map((it) => (
              <CartRow
                key={it.id}
                item={it}
                members={props.members}
                canEdit={(it.added_by_member_id === props.selfMemberId || props.isHost) && !guestLock}
                onRemove={() => confirmRemove(it)}
                onChangeQty={(delta) => {
                  if (delta < 0 && (it.quantity ?? 1) <= 1) {
                    confirmRemove(it);
                    return;
                  }
                  props.onChangeQty(it, delta);
                }}
              />
            ))
          )}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 12, gap: 10 }}>
        <Pressable onPress={() => {
          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          props.onLeave();
        }} style={[s.secondaryBtn, { flex: 1 }]}>
          <Text style={s.secondaryBtnText}>Leave</Text>
        </Pressable>
        {props.isHost ? (() => {
          const needsGuests = props.members.length < 2;
          const noItems = props.items.length === 0;
          const disabled = needsGuests || noItems;
          const label = needsGuests ? 'Waiting for guests to join…' : 'Review & checkout';
          return (
            <Pressable
              onPress={() => {
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                props.onReview?.();
              }}
              disabled={disabled}
              style={[s.primaryBtn, { flex: 2 }, disabled && { opacity: 0.55 }]}
            >
              <Text style={s.primaryBtnText}>{label}</Text>
            </Pressable>
          );
        })(        ) : (
          <View style={[s.primaryBtn, { flex: 2, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder }]}>
            <Text style={[s.primaryBtnText, { color: colors.textMuted, fontSize: 14 }]}>
              {props.hostDeciding ? 'Host is deciding how to pay' : 'Waiting on host…'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function CartRow({ item, members, canEdit, onRemove, onChangeQty }: {
  item: PartyItem; members: PartyMember[]; canEdit: boolean;
  onRemove: () => void; onChangeQty: (delta: number) => void;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  const owner = memberById(members, item.added_by_member_id);
  return (
    <View style={s.cartRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.cartItemName} numberOfLines={1}>{item.menu_item?.name ?? 'Item'}</Text>
        <Text style={s.cartItemMeta} numberOfLines={1}>
          added by <Text style={{ color: colors.text }}>{owner?.display_name ?? item.added_by_name ?? 'Guest'}</Text>
          {item.quantity > 1 ? ` · x${item.quantity}` : ''}
        </Text>
      </View>
      {canEdit ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChangeQty(-1);
            }}
            style={s.qtyBtn}
          >
            <Minus size={14} color={colors.text} />
          </Pressable>
          <Text style={s.qtyText}>{item.quantity}</Text>
          <Pressable
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChangeQty(1);
            }}
            style={s.qtyBtn}
          >
            <Plus size={14} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onRemove();
            }}
            style={s.qtyTrashBtn}
          >
            <Trash2 size={14} color="#dc2626" />
          </Pressable>
        </View>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>x{item.quantity}</Text>
      )}
    </View>
  );
}

function ReviewStage({
  sessionId,
  snapshot, restaurant, creds, onBack, onAssignPayer, onSetSplit, onSetMode, onLock, busy,
}: {
  sessionId: string;
  snapshot: PartySnapshot; restaurant: Restaurant | null; creds: PartyCreds;
  onBack: () => void; onAssignPayer: (itemId: string, payerId: string) => Promise<void>;
  onSetSplit: (itemId: string, memberIds: string[]) => Promise<void>;
  onSetMode: (mode: PaymentMode) => Promise<void>;
  onLock: () => Promise<void>; busy: boolean;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await setHostInReview(supabase, sessionId, true);
      } catch (e) {
        if (!cancelled) console.warn('setHostInReview', e);
      }
    })();
    return () => {
      cancelled = true;
      void setHostInReview(supabase, sessionId, false).catch(() => {});
    };
  }, [sessionId]);
  const modeFromSnapshot = (snapshot.session.payment_mode === 'split' ? 'per_person'
    : snapshot.session.payment_mode === 'assign' ? 'assigned'
    : snapshot.session.payment_mode) as PaymentMode;
  const [mode, setMode] = useState<PaymentMode>(modeFromSnapshot);
  useEffect(() => {
    setMode(modeFromSnapshot);
  }, [modeFromSnapshot]);

  const total = totalCartCents(snapshot.items);
  const taxItems = useMemo(() => snapshot.items.map(it => ({
    price_cents: Math.round(Number(it.menu_item?.price ?? 0) * 100),
    quantity: it.quantity ?? 1,
    stripe_tax_code: it.menu_item?.stripe_tax_code ?? "txcd_40060003",
  })), [snapshot.items]);
  const { taxCents, loading: taxLoading } = useCartTax(restaurant?.id ?? -1, taxItems);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <TopBar title="Review" subtitle={restaurant?.name ?? undefined} onBack={onBack} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
          <Animated.View entering={FadeInDown} style={s.headerCard}>
            <Text style={s.summaryLabel}>Order summary</Text>
            <View style={{ marginTop: 4 }}>
              <TaxEstimateLine
                subtotalDollars={(total ?? 0) / 100}
                taxCents={taxCents}
                showSubtotal
                showTotal
                totalHero
              />
            </View>
            <Text style={[s.summaryMeta, { marginTop: 10 }]}>
              {snapshot.members.length} {snapshot.members.length === 1 ? 'member' : 'members'} · {snapshot.items.length} {snapshot.items.length === 1 ? 'item' : 'items'}
            </Text>
          </Animated.View>

          <Text style={s.sectionLabel}>How should the bill be paid?</Text>
          <View style={{ gap: 10 }}>
            {PAYMENT_MODES.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => {
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (mode === m.key) return;
                  setMode(m.key); // optimistic for instant UI response
                  onSetMode(m.key);
                }}
                style={[s.modeCard, mode === m.key && s.modeCardActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.modeTitle, mode === m.key && { color: '#FF9933' }]}>{m.title}</Text>
                  <Text style={s.modeSubtitle}>{m.subtitle}</Text>
                </View>
                {mode === m.key ? <Check size={18} color="#FF9933" strokeWidth={3} /> : null}
              </Pressable>
            ))}
          </View>

          {mode === 'assigned' ? (
            <>
              <Text style={[s.sectionLabel, { marginTop: 22 }]}>Choose a payer for each item</Text>
              {snapshot.items.map((it) => (
                <AssignItemRow key={it.id} item={it} members={snapshot.members} onAssign={(pid) => onAssignPayer(it.id, pid)} />
              ))}
            </>
          ) : null}

          {mode === 'per_person' ? (
            <>
              <Text style={[s.sectionLabel, { marginTop: 22 }]}>Fine-tune who pays for what</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 10 }}>
                By default each person pays for the items they added. Tap names below to share an item between multiple people.
              </Text>
              {snapshot.items.map((it) => (
                <SplitItemRow key={it.id} item={it} members={snapshot.members} onSetSplit={(ids) => onSetSplit(it.id, ids)} />
              ))}
            </>
          ) : null}
        </ScrollView>

        <View style={s.bottomBar}>
          <Pressable onPress={onLock} disabled={busy} style={[s.primaryBtn, { flex: 1 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#ffffff" /> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Lock size={16} color="#ffffff" />
                <Text style={s.primaryBtnText}>Lock cart &amp; start collecting</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </>
  );
}

function AssignItemRow({ item, members, onAssign }: { item: PartyItem; members: PartyMember[]; onAssign: (payerId: string) => Promise<void> }) {
  const s = useJoinS();
  const serverCurrentId = (memberById(members, item.assigned_payer_id) ?? memberById(members, item.added_by_member_id))?.id ?? null;
  // Optimistic selection so the tapped chip highlights immediately. Clears
  // once the realtime snapshot catches up with the pending value.
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    if (pendingId && pendingId === serverCurrentId) setPendingId(null);
  }, [pendingId, serverCurrentId]);
  const currentId = pendingId ?? serverCurrentId;
  return (
    <View style={s.assignRow}>
      <Text style={s.assignName} numberOfLines={1}>{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.menu_item?.name ?? 'Item'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {members.map((m) => (
          <Pressable
            key={m.id}
            onPress={async () => {
              if (Platform.OS !== 'web') Haptics.selectionAsync();
              const prev = pendingId;
              setPendingId(m.id);
              try {
                await onAssign(m.id);
              } catch {
                setPendingId(prev);
              }
            }}
            style={[s.assignPill, currentId === m.id && s.assignPillActive]}
          >
            <Text style={[s.assignPillText, currentId === m.id && s.assignPillTextActive]} numberOfLines={1}>
              {m.display_name.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function SplitItemRow({ item, members, onSetSplit }: { item: PartyItem; members: PartyMember[]; onSetSplit: (ids: string[]) => Promise<void> }) {
  const s = useJoinS();
  const serverIds = useMemo(() => item.split_member_ids ?? [], [item.split_member_ids]);
  // Optimistic overlay so tapping a chip flips it instantly; the overlay is
  // cleared once the server snapshot matches.
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!pendingIds) return;
    const a = [...pendingIds].sort().join(',');
    const b = [...serverIds].sort().join(',');
    if (a === b) setPendingIds(null);
  }, [pendingIds, serverIds]);
  const currentIds = pendingIds ?? serverIds;
  const toggleId = async (id: string) => {
    const set = new Set(currentIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    const prev = pendingIds;
    setPendingIds(next);
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    try {
      await onSetSplit(next);
    } catch {
      setPendingIds(prev);
    }
  };
  return (
    <View style={s.assignRow}>
      <Text style={s.assignName} numberOfLines={1}>{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.menu_item?.name ?? 'Item'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {members.map((m) => {
          const selected = currentIds.includes(m.id);
          return (
            <Pressable key={m.id} onPress={() => toggleId(m.id)} style={[s.assignPill, selected && s.assignPillActive]}>
              <Text style={[s.assignPillText, selected && s.assignPillTextActive]} numberOfLines={1}>
                {m.display_name.split(' ')[0]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CancelSheet({ visible, onCancel, onConfirm, busy }: { visible: boolean; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  const s = useJoinS();
  if (!visible) return null;
  const tap = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={s.sheetBackdrop}>
      <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutDown.duration(160)} style={s.cancelSheet}>
        <Text style={s.sheetTitle}>Cancel group order?</Text>
        <Text style={s.sheetBody}>Any paid shares will be refunded via Stripe. This can&apos;t be undone.</Text>
        <Pressable onPress={() => { tap(); onConfirm(); }} disabled={busy} style={[s.dangerBtnSolid, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.dangerBtnSolidText}>Cancel & refund</Text>}
        </Pressable>
        <Pressable onPress={() => { tap(); onCancel(); }} style={s.neverMindBtn}>
          <Text style={s.neverMindBtnText}>Never mind</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function MemberItemsSheet({
  visible, member, memberIndex, items, isSelf, onClose,
}: {
  visible: boolean;
  member: PartyMember | null;
  memberIndex: number;
  items: PartyItem[];
  isSelf: boolean;
  onClose: () => void;
}) {
  const s = useJoinS();
  const { colors } = useAppTheme();
  if (!visible || !member) return null;
  const color = ['#FF9933', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'][memberIndex % 8];
  const totalCents = items.reduce((sum, it) => {
    const price = Math.round(Number(it.menu_item?.price ?? 0) * 100);
    return sum + price * (it.quantity ?? 1);
  }, 0);
  const itemCount = items.reduce((sum, it) => sum + (it.quantity ?? 1), 0);
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={s.sheetBackdrop}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View entering={FadeInDown.duration(180)} style={s.memberSheet}>
        <View style={s.memberSheetHeader}>
          <View style={[s.avatarMd, { backgroundColor: member.avatar_url ? colors.pressableBg : color, overflow: 'hidden' }]}>
            {member.avatar_url ? (
              <Image source={{ uri: member.avatar_url }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Text style={s.avatarMdText}>{memberInitials(member.display_name)}</Text>
            )}
            {member.role === 'host' ? (
              <View style={s.crownBadge}><Crown size={10} color="#FFF" strokeWidth={3} /></View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.memberSheetTitle} numberOfLines={1}>
              {isSelf ? `${member.display_name} · You` : member.display_name}
            </Text>
            <Text style={s.memberSheetSubtitle}>
              {itemCount === 0 ? 'No items yet' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${formatCents(totalCents)}`}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={s.memberSheetClose}>
            <X size={18} color={colors.iconMuted} />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}>
            <ShoppingCart size={22} color={colors.iconMuted} />
            <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 13 }}>
              {isSelf ? "You haven't added anything yet." : `${member.display_name.split(' ')[0]} hasn't added anything yet.`}
            </Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 6 }}>
            {items.map((it) => {
              const priceCents = Math.round(Number(it.menu_item?.price ?? 0) * 100);
              return (
                <View key={it.id} style={s.memberSheetRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberSheetItemName} numberOfLines={1}>
                      {it.quantity > 1 ? `${it.quantity}× ` : ''}{it.menu_item?.name ?? 'Item'}
                    </Text>
                    {it.special_requests ? (
                      <Text style={s.memberSheetNote} numberOfLines={2}>{it.special_requests}</Text>
                    ) : null}
                  </View>
                  <Text style={s.memberSheetPrice}>{formatCents(priceCents * (it.quantity ?? 1))}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function PulseRing() {
  const s = useJoinS();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.8);
  useEffect(() => {
    scale.value = withRepeat(withTiming(2, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false);
    opacity.value = withRepeat(withSequence(
      withTiming(0.8, { duration: 0 }),
      withTiming(0, { duration: 1400, easing: Easing.out(Easing.ease) }),
    ), -1, false);
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return <Animated.View style={[s.pulseRing, style]} />;
}

function SuccessScreen({ snapshot, restaurant, creds, onDone }: { snapshot: PartySnapshot; restaurant: Restaurant | null; creds: PartyCreds; onDone: () => void }) {
  const s = useJoinS();
  const me = snapshot.members.find((m) => m.id === creds.memberId);
  const myPayment = paymentForMember(snapshot.payments, creds.memberId);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingTop: 80, paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
            <View style={s.successBadgeWrapper}>
              <PulseRing />
              <View style={s.successBadge}><PartyPopper size={32} color="#FF9933" /></View>
            </View>
            <Text style={s.successTitle}>All paid up!</Text>
            <Text style={s.successSubtitle}>
              Your group order at {restaurant?.name ?? 'the restaurant'} is in. The kitchen is on it.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120)} style={[s.headerCard, { marginTop: 20 }]}>
            <Text style={s.summaryLabel}>Order summary</Text>
            <View style={{ marginTop: 4 }}>
              <TaxEstimateLine
                subtotalDollars={(snapshot.session.subtotal_cents ?? 0) / 100}
                taxCents={snapshot.session.tax_cents ?? null}
                showSubtotal
                showTotal
                totalHero
              />
            </View>
            <Text style={s.summaryMeta}>
              {snapshot.members.length} members · {snapshot.items.length} items
            </Text>
          </Animated.View>

          {myPayment && me ? (
            <Animated.View entering={FadeInDown.delay(200)} style={s.receiptCard}>
              <Text style={s.receiptLabel}>Your receipt</Text>
              <Text style={s.receiptName}>{me.display_name}</Text>
              <Text style={s.receiptAmount}>{formatCents(myPayment.amount_cents)} · {myPayment.status === 'covered' ? 'covered by host' : 'paid'}</Text>
            </Animated.View>
          ) : null}

          <View style={{ marginTop: 16 }}>
            <PartyLedger
              members={snapshot.members}
              payments={snapshot.payments}
              selfMemberId={creds.memberId}
              isHost={me?.role === 'host'}
              orderSubtotalCents={snapshot.session.subtotal_cents ?? 0}
              orderTaxCents={snapshot.session.tax_cents ?? 0}
              items={snapshot.items}
              paymentMode={snapshot.session.payment_mode}
              staffManaged={snapshot.session.staff_managed}
            />
          </View>
        </ScrollView>
        <View style={s.bottomBar}>
          <Pressable onPress={onDone} style={[s.primaryBtn, { flex: 1 }]}>
            <Text style={s.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function cartCountFor(items: PartyItem[], menuItemId: number): number {
  return items.filter((i) => i.menu_item_id === menuItemId).reduce((sum, i) => sum + (i.quantity ?? 1), 0);
}
