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
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, ScrollView, Platform,
  KeyboardAvoidingView, Alert, ActivityIndicator, StyleSheet, Image, Share,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import Animated, {
  FadeIn, FadeInDown, FadeOut, SlideInUp,
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
import {
  joinSession, addItem, updateItemQuantity, removeItem,
  setPaymentMode, setItemSplit, assignItemPayer,
  lockSession, unlockSession, startCheckout, cancelSession, leaveSession,
  fetchSnapshot,
  formatCents, memberById, paymentForMember, isFullyPaid, totalCartCents,
  type PartyCreds, type PartySnapshot, type PaymentMode, type PartyMember, type PartyItem,
} from '../../lib/party-session';
import {
  loadPartyCreds, savePartyCreds, clearPartyCreds,
  loadLastDisplayName, saveLastDisplayName,
} from '../../lib/party-credentials';
import { subscribeToParty } from '../../lib/party-realtime';
import { PartyLedger, colorForMember, memberInitials } from '../../components/party/PartyLedger';

type MenuItem = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_vegetarian: boolean;
  is_spicy: boolean | null;
  category: string | null;
  in_stock: boolean;
};

type Restaurant = { id: number; name: string; image_url: string | null };

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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);

  const session = snapshot?.session ?? null;
  const members = snapshot?.members ?? [];
  const items = snapshot?.items ?? [];
  const payments = snapshot?.payments ?? [];
  const me = creds ? members.find((m) => m.id === creds.memberId) ?? null : null;
  const isHost = me?.role === 'host';
  const myPayment = creds ? paymentForMember(payments, creds.memberId) : null;

  // NOTE: All hooks (useState/useEffect/useMemo/useCallback) must be called
  // unconditionally BEFORE any early-return branches below. The filtered-menu
  // memo in particular was previously invoked from JSX in the browse stage,
  // which made the hook count change between renders (e.g. loading vs browse).
  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((m) => {
      if (categoryFilter && m.category !== categoryFilter) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q);
    });
  }, [menu, search, categoryFilter]);

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
      if (saved) setCreds(saved);
      setCredsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Pre-fill nameInput with (a) the last name the user joined a party with,
  // and (b) as a final fallback, the logged-in user's profile name/email.
  // This means a returning guest who previously typed "John" never has to
  // type their name again for any subsequent party.
  useEffect(() => {
    if (nameInput.trim().length > 0) return;
    let cancelled = false;
    (async () => {
      const last = await loadLastDisplayName();
      if (cancelled) return;
      if (last) { setNameInput(last); return; }
      const meta: any = authSession?.user?.user_metadata ?? {};
      const candidate = (
        meta.full_name || meta.name || meta.display_name ||
        [meta.first_name, meta.last_name].filter(Boolean).join(' ') ||
        (authSession?.user?.email ? String(authSession.user.email).split('@')[0] : '')
      );
      const fallback = typeof candidate === 'string' ? candidate.trim() : '';
      if (fallback) setNameInput(fallback);
    })();
    return () => { cancelled = true; };
  }, [authSession?.user?.id]);

  // Fetch initial snapshot + menu
  const loadAll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const snap = await fetchSnapshot(supabase, sessionId);
      setSnapshot(snap);
      if (!restaurant || restaurant.id !== snap.session.restaurant_id) {
        const { data: rest } = await supabase
          .from('restaurants')
          .select('id, name, image_url')
          .eq('id', snap.session.restaurant_id)
          .maybeSingle();
        if (rest) setRestaurant(rest as Restaurant);
        const { data: menuRows } = await supabase
          .from('menu_items')
          .select('id, name, description, price, image_url, is_vegetarian, is_spicy, category, in_stock')
          .eq('restaurant_id', snap.session.restaurant_id)
          .eq('in_stock', true)
          .order('category', { ascending: true })
          .order('name', { ascending: true });
        setMenu((menuRows ?? []) as MenuItem[]);
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
      (snap) => setSnapshot(snap),
      (err) => console.warn('Party realtime error:', err.message),
    );
    return () => handle.unsubscribe();
  }, [sessionId]);

  // Handle checkout return (from payment-redirect deep link)
  useEffect(() => {
    const status = params.checkout_status;
    if (!status) return;
    if (status === 'success') {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (status === 'cancel') {
      Alert.alert('Payment cancelled', 'You can try again when you are ready.');
    } else if (status === 'error') {
      Alert.alert('Payment issue', params.reason === 'payment_mismatch' ? 'Payment amount mismatch detected.' : 'We could not verify the payment. Please try again.');
    }
  }, [params.checkout_status, params.reason]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    const name = nameInput.trim();
    if (!name) { Alert.alert('Enter your name', 'Please enter your name to continue.'); return; }
    setJoining(true);
    try {
      const result = await joinSession(supabase, sessionId, name);
      const next: PartyCreds = { sessionId, memberId: result.member_id, memberToken: result.member_token };
      setCreds(next);
      await savePartyCreds(next);
      await saveLastDisplayName(name);
      await loadAll();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Join failed', err instanceof Error ? err.message : 'Unable to join group.');
    } finally {
      setJoining(false);
    }
  };

  const handleAddItem = async (menuItemId: number) => {
    if (!creds) return;
    try {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await addItem(supabase, creds, menuItemId, 1);
    } catch (err) {
      Alert.alert('Could not add item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleChangeQty = async (item: PartyItem, delta: number) => {
    if (!creds) return;
    const nextQty = Math.max(0, (item.quantity ?? 1) + delta);
    try {
      await updateItemQuantity(supabase, creds, item.id, nextQty);
      if (Platform.OS !== 'web') Haptics.selectionAsync();
    } catch (err) {
      Alert.alert('Could not update item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleRemoveItem = async (item: PartyItem) => {
    if (!creds) return;
    try {
      await removeItem(supabase, creds, item.id);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      Alert.alert('Could not remove item', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleSetMode = async (mode: PaymentMode) => {
    if (!creds) return;
    try {
      await setPaymentMode(supabase, creds, mode);
      if (Platform.OS !== 'web') Haptics.selectionAsync();
    } catch (err) {
      Alert.alert('Could not change mode', err instanceof Error ? err.message : 'Try again.');
    }
  };

  const handleLock = async () => {
    if (!creds) return;
    if (items.length === 0) { Alert.alert('Empty cart', 'Add at least one item before checking out.'); return; }
    setBusy(true);
    try {
      await lockSession(supabase, creds);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not lock cart', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (!creds) return;
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
    if (!myPayment || myPayment.amount_cents <= 0) return;
    setBusy(true);
    try {
      const { url } = await startCheckout(supabase, creds, {
        returnUrlBase: Linking.createURL(`/join/${sessionId}`),
      });
      await openStripeCheckout(url);
    } catch (err) {
      Alert.alert('Checkout failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleCoverMember = async (memberId: string) => {
    if (!creds) return;
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
              Alert.alert('Checkout failed', err instanceof Error ? err.message : 'Try again.');
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
    setBusy(true);
    try {
      const result = await cancelSession(supabase, creds);
      Alert.alert('Group order cancelled', `${result.refunded} payment${result.refunded === 1 ? '' : 's'} refunded.`);
      await clearPartyCreds(sessionId);
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
            await clearPartyCreds(sessionId);
            router.back();
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    const url = `https://rasvia.com/join?id=${sessionId}`;
    try {
      if (Platform.OS === 'web') await Clipboard.setStringAsync(url);
      else await Share.share({ message: `Join my Rasvia group order: ${url}`, url });
    } catch { /* ignore */ }
  };

  // ── Loading / error early returns ───────────────────────────────────────
  if (!sessionId) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>Missing session id.</Text>
      </View>
    );
  }
  // Wait for BOTH the initial snapshot load AND the saved-creds read before
  // deciding whether to show the name-entry screen. Otherwise a returning
  // guest sees a brief flicker of the name prompt before being switched to
  // the browse view once creds resolve.
  if (loading || !credsLoaded) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color="#FF9933" />
      </View>
    );
  }
  if (errorMsg) {
    return (
      <View style={s.centered}>
        <AlertCircle size={32} color="#EF4444" />
        <Text style={s.errorText}>{errorMsg}</Text>
        <Pressable onPress={() => { setErrorMsg(null); loadAll(); }} style={s.retryBtn}>
          <Text style={s.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!session) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>Group order not found.</Text>
      </View>
    );
  }

  // ── Cancelled session kicks everyone out ────────────────────────────────
  if (session.status === 'cancelled') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered}>
          <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 10, maxWidth: 340 }}>
            <View style={s.cancelledBadge}><X size={32} color="#EF4444" strokeWidth={3} /></View>
            <Text style={s.successTitle}>Group order ended</Text>
            <Text style={s.successSubtitle}>
              {restaurant?.name ? `The host cancelled the group order at ${restaurant.name}.` : 'The host cancelled this group order.'}
              {' '}Any paid shares have been refunded.
            </Text>
            <Pressable
              onPress={async () => { await clearPartyCreds(sessionId); router.replace('/'); }}
              style={[s.primaryBtn, { marginTop: 10, alignSelf: 'stretch' }]}
            >
              <Text style={s.primaryBtnText}>Back to home</Text>
            </Pressable>
          </Animated.View>
        </View>
      </>
    );
  }

  // ── Name entry ──────────────────────────────────────────────────────────
  if (!creds || !me) {
    const hasPrefill = nameInput.trim().length > 0;
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.joinContainer}>
          <Animated.View entering={FadeIn} style={s.joinCard}>
            <View style={s.joinBadge}>
              <Users size={14} color="#FF9933" />
              <Text style={s.joinBadgeText}>Group order</Text>
            </View>
            <Text style={s.joinTitle}>Join at {restaurant?.name ?? 'this restaurant'}</Text>
            <Text style={s.joinSubtitle}>Your name shows up on the order so everyone knows who added what.</Text>
            <TextInput
              placeholder="Your name"
              placeholderTextColor="#71717A"
              style={s.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus={!hasPrefill}
              selectTextOnFocus
              maxLength={60}
              returnKeyType="go"
              onSubmitEditing={handleJoin}
            />
            <Pressable onPress={handleJoin} disabled={joining} style={[s.primaryBtn, joining && { opacity: 0.6 }]}>
              {joining ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text style={s.primaryBtnText}>{hasPrefill ? `Continue as ${nameInput.trim()}` : 'Join'}</Text>
              )}
            </Pressable>
            <Pressable onPress={() => router.back()} style={s.textBtn}>
              <Text style={s.textBtnText}>Not now</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </>
    );
  }

  // ── Success stage ───────────────────────────────────────────────────────
  if (view === 'success' && (session.status === 'submitted' || session.status === 'completed')) {
    return (
      <SuccessScreen
        snapshot={snapshot!}
        restaurant={restaurant}
        creds={creds}
        onDone={async () => {
          await clearPartyCreds(sessionId);
          router.replace('/');
        }}
      />
    );
  }

  // ── Pay & Wait stage ────────────────────────────────────────────────────
  if (view === 'pay' && (session.status === 'locked' || session.status === 'paying')) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.container}>
          <TopBar
            title={restaurant?.name ?? 'Group order'}
            subtitle={session.status === 'paying' ? 'Collecting payments' : 'Ready to pay'}
            onBack={() => router.back()}
          />
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            <Animated.View entering={FadeInDown} style={s.headerCard}>
              <Text style={s.summaryLabel}>Group total</Text>
              <Text style={s.summaryValue}>{formatCents(session.total_cents)}</Text>
              <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Lock size={12} color="#A1A1AA" />
                <Text style={s.summaryMeta}>{members.length} {members.length === 1 ? 'member' : 'members'} · {items.length} {items.length === 1 ? 'item' : 'items'}</Text>
              </View>
            </Animated.View>

            <View style={{ marginTop: 16 }}>
              <PartyLedger
                members={members}
                payments={payments}
                selfMemberId={creds.memberId}
                isHost={isHost}
                onCoverMember={handleCoverMember}
                onRetry={handlePayMyShare}
                onMemberTap={(id) => setViewingMemberId(id)}
              />
            </View>

            {myPayment && myPayment.amount_cents > 0 && myPayment.status !== 'paid' && myPayment.status !== 'covered' ? (
              <Animated.View entering={FadeInDown.delay(150)} style={s.payCta}>
                <Text style={s.payCtaLabel}>Your share</Text>
                <Text style={s.payCtaAmount}>{formatCents(myPayment.amount_cents)}</Text>
                <Pressable onPress={handlePayMyShare} disabled={busy} style={[s.primaryBtn, { marginTop: 8 }, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color="#0f0f0f" /> : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <CreditCard size={18} color="#0f0f0f" />
                      <Text style={s.primaryBtnText}>Pay now</Text>
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            ) : myPayment && (myPayment.status === 'paid' || myPayment.status === 'covered') ? (
              <Animated.View entering={FadeInDown.delay(150)} style={[s.payCta, { borderColor: 'rgba(34,197,94,0.35)' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Check size={18} color="#22C55E" />
                  <Text style={[s.payCtaLabel, { color: '#22C55E' }]}>Your share is paid</Text>
                </View>
              </Animated.View>
            ) : null}

            {isHost ? (
              <View style={{ marginTop: 20, gap: 8 }}>
                {session.status === 'locked' && !payments.some((p) => p.status === 'paid' || p.status === 'covered') ? (
                  <Pressable onPress={handleUnlock} disabled={busy} style={s.secondaryBtn}>
                    <Unlock size={16} color="#A1A1AA" />
                    <Text style={s.secondaryBtnText}>Back to editing</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setShowCancelConfirm(true)} disabled={busy} style={s.dangerBtn}>
                  <X size={16} color="#EF4444" />
                  <Text style={s.dangerBtnText}>Cancel group order</Text>
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
    return (
      <ReviewStage
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

  // ── Browse & Add stage (default) ────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <TopBar
          title={restaurant?.name ?? 'Group order'}
          subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · ${items.length} item${items.length === 1 ? '' : 's'}`}
          rightIcon="share"
          onBack={() => router.back()}
          onRight={handleShare}
        />

        {/* Members strip — tap a member to see what they've ordered */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.membersStrip} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
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
        <View style={s.searchBar}>
          <Search size={16} color="#71717A" />
          <TextInput
            placeholder="Search menu"
            placeholderTextColor="#71717A"
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Categories */}
        <CategoryChips menu={menu} active={categoryFilter} onChange={setCategoryFilter} />

        {/* Menu list */}
        <FlatList
          data={filteredMenu}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 180 }}
          renderItem={({ item }) => (
            <MenuRow item={item} inCartCount={cartCountFor(items, item.id)} onAdd={() => handleAddItem(item.id)} />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 56, gap: 6 }}>
              <Search size={24} color="#3F3F46" />
              <Text style={{ color: '#A1A1AA', fontWeight: '600', fontSize: 13 }}>Nothing matches that filter.</Text>
              <Text style={{ color: '#52525B', fontSize: 11 }}>Try clearing the search or category.</Text>
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
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function TopBar({ title, subtitle, onBack, rightIcon, onRight }: { title: string; subtitle?: string; onBack?: () => void; rightIcon?: 'share' | 'close'; onRight?: () => void }) {
  return (
    <View style={s.topBar}>
      <Pressable onPress={onBack} hitSlop={12}>
        <ArrowLeft size={22} color="#F4F4F5" />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text style={s.topTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.topSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onRight && rightIcon === 'share' ? (
        <Pressable onPress={onRight} hitSlop={12}>
          <Share2 size={20} color="#F4F4F5" />
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
  const color = colorForMember(member.id, []);
  const fallback = ['#FF9933', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'][index % 8];
  return (
    <Pressable onPress={onPress} style={[s.memberChip, isSelf && { borderColor: '#FF9933' }]}>
      <View style={[s.avatarSm, { backgroundColor: color || fallback }]}>
        <Text style={s.avatarSmText}>{memberInitials(member.display_name)}</Text>
        {member.role === 'host' ? <Crown size={10} color="#FFF" style={{ position: 'absolute', top: -4, right: -4 }} strokeWidth={3} /> : null}
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

function CategoryChips({ menu, active, onChange }: { menu: MenuItem[]; active: string | null; onChange: (v: string | null) => void }) {
  const cats = useMemo(() => Array.from(new Set(menu.map((m) => m.category).filter(Boolean))) as string[], [menu]);
  if (cats.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginTop: 8, maxHeight: 40 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
    >
      <Pressable onPress={() => onChange(null)} style={[s.catChip, !active && s.catChipActive]}>
        <Text numberOfLines={1} style={[s.catChipText, !active && s.catChipTextActive]}>All</Text>
      </Pressable>
      {cats.map((c) => (
        <Pressable key={c} onPress={() => onChange(c === active ? null : c)} style={[s.catChip, active === c && s.catChipActive]}>
          <Text numberOfLines={1} style={[s.catChipText, active === c && s.catChipTextActive]}>{c}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function MenuRow({ item, inCartCount, onAdd }: { item: MenuItem; inCartCount: number; onAdd: () => void }) {
  return (
    <Animated.View entering={FadeInDown} style={s.menuRow}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={s.menuImg} />
      ) : (
        <View style={[s.menuImg, { backgroundColor: '#27272A', alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#52525B' }}>—</Text>
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
      <Pressable onPress={onAdd} style={s.addBtn}>
        <Plus size={16} color="#0f0f0f" strokeWidth={3} />
        {inCartCount > 0 ? <Text style={s.addBtnCount}>{inCartCount}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

function CartSummary(props: {
  items: PartyItem[];
  members: PartyMember[];
  selfMemberId: string;
  canEdit: boolean;
  isHost: boolean;
  onReview?: () => void;
  onRemove: (item: PartyItem) => void;
  onChangeQty: (item: PartyItem, delta: number) => void;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const total = totalCartCents(props.items);
  const myItems = props.items.filter((i) => i.added_by_member_id === props.selfMemberId);

  return (
    <View style={s.cartContainer}>
      <Pressable onPress={() => setOpen((v) => !v)} style={s.cartHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ShoppingCart size={18} color="#FF9933" />
          <Text style={s.cartTitle}>{props.items.length} item{props.items.length === 1 ? '' : 's'}</Text>
          <Text style={s.cartTotal}>{formatCents(total)}</Text>
        </View>
        <ChevronRight size={18} color="#A1A1AA" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          {props.items.length === 0 ? (
            <Text style={{ color: '#71717A', paddingVertical: 14 }}>No items yet. Add something from the menu above.</Text>
          ) : (
            props.items.map((it) => (
              <CartRow
                key={it.id}
                item={it}
                members={props.members}
                canEdit={it.added_by_member_id === props.selfMemberId || props.isHost}
                onRemove={() => props.onRemove(it)}
                onChangeQty={(delta) => props.onChangeQty(it, delta)}
              />
            ))
          )}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 12, gap: 10 }}>
        <Pressable onPress={props.onLeave} style={[s.secondaryBtn, { flex: 1 }]}>
          <Text style={s.secondaryBtnText}>Leave</Text>
        </Pressable>
        {props.isHost ? (() => {
          const needsGuests = props.members.length < 2;
          const noItems = props.items.length === 0;
          const disabled = needsGuests || noItems;
          const label = needsGuests ? 'Waiting for guests to join…' : 'Review & checkout';
          return (
            <Pressable
              onPress={props.onReview}
              disabled={disabled}
              style={[s.primaryBtn, { flex: 2 }, disabled && { opacity: 0.55 }]}
            >
              <Text style={s.primaryBtnText}>{label}</Text>
            </Pressable>
          );
        })() : (
          <View style={[s.primaryBtn, { flex: 2, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }]}>
            <Text style={[s.primaryBtnText, { color: '#A1A1AA' }]}>Waiting on host…</Text>
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
  const owner = memberById(members, item.added_by_member_id);
  return (
    <View style={s.cartRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.cartItemName} numberOfLines={1}>{item.menu_item?.name ?? 'Item'}</Text>
        <Text style={s.cartItemMeta} numberOfLines={1}>
          added by <Text style={{ color: '#F4F4F5' }}>{owner?.display_name ?? item.added_by_name ?? 'Guest'}</Text>
          {item.quantity > 1 ? ` · x${item.quantity}` : ''}
        </Text>
      </View>
      {canEdit ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={() => onChangeQty(-1)} style={s.qtyBtn}><Minus size={14} color="#F4F4F5" /></Pressable>
          <Text style={s.qtyText}>{item.quantity}</Text>
          <Pressable onPress={() => onChangeQty(1)} style={s.qtyBtn}><Plus size={14} color="#F4F4F5" /></Pressable>
          <Pressable onPress={onRemove} style={s.qtyBtn}><Trash2 size={14} color="#EF4444" /></Pressable>
        </View>
      ) : (
        <Text style={{ color: '#A1A1AA', fontSize: 12 }}>x{item.quantity}</Text>
      )}
    </View>
  );
}

function ReviewStage({
  snapshot, restaurant, creds, onBack, onAssignPayer, onSetSplit, onSetMode, onLock, busy,
}: {
  snapshot: PartySnapshot; restaurant: Restaurant | null; creds: PartyCreds;
  onBack: () => void; onAssignPayer: (itemId: string, payerId: string) => Promise<void>;
  onSetSplit: (itemId: string, memberIds: string[]) => Promise<void>;
  onSetMode: (mode: PaymentMode) => Promise<void>;
  onLock: () => Promise<void>; busy: boolean;
}) {
  const mode = (snapshot.session.payment_mode === 'split' ? 'per_person'
    : snapshot.session.payment_mode === 'assign' ? 'assigned'
    : snapshot.session.payment_mode) as PaymentMode;

  const total = totalCartCents(snapshot.items);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <TopBar title="Review" subtitle={restaurant?.name ?? undefined} onBack={onBack} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
          <Animated.View entering={FadeInDown} style={s.headerCard}>
            <Text style={s.summaryLabel}>Group total</Text>
            <Text style={s.summaryValue}>{formatCents(total)}</Text>
            <Text style={s.summaryMeta}>
              {snapshot.members.length} {snapshot.members.length === 1 ? 'member' : 'members'} · {snapshot.items.length} {snapshot.items.length === 1 ? 'item' : 'items'}
            </Text>
          </Animated.View>

          <Text style={s.sectionLabel}>How should the bill be paid?</Text>
          <View style={{ gap: 10 }}>
            {PAYMENT_MODES.map((m) => (
              <Pressable key={m.key} onPress={() => onSetMode(m.key)} style={[s.modeCard, mode === m.key && s.modeCardActive]}>
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
              <Text style={{ color: '#71717A', fontSize: 12, marginBottom: 10 }}>
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
            {busy ? <ActivityIndicator color="#0f0f0f" /> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Lock size={16} color="#0f0f0f" />
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
  const current = memberById(members, item.assigned_payer_id) ?? memberById(members, item.added_by_member_id);
  return (
    <View style={s.assignRow}>
      <Text style={s.assignName} numberOfLines={1}>{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.menu_item?.name ?? 'Item'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {members.map((m) => (
          <Pressable key={m.id} onPress={() => onAssign(m.id)} style={[s.assignPill, current?.id === m.id && s.assignPillActive]}>
            <Text style={[s.assignPillText, current?.id === m.id && { color: '#0f0f0f' }]} numberOfLines={1}>
              {m.display_name.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function SplitItemRow({ item, members, onSetSplit }: { item: PartyItem; members: PartyMember[]; onSetSplit: (ids: string[]) => Promise<void> }) {
  const currentIds = item.split_member_ids ?? [];
  const toggleId = (id: string) => {
    const set = new Set(currentIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onSetSplit(Array.from(set));
  };
  return (
    <View style={s.assignRow}>
      <Text style={s.assignName} numberOfLines={1}>{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.menu_item?.name ?? 'Item'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {members.map((m) => {
          const selected = currentIds.includes(m.id);
          return (
            <Pressable key={m.id} onPress={() => toggleId(m.id)} style={[s.assignPill, selected && s.assignPillActive]}>
              <Text style={[s.assignPillText, selected && { color: '#0f0f0f' }]} numberOfLines={1}>
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
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={s.sheetBackdrop}>
      <Animated.View entering={SlideInUp} style={s.sheet}>
        <Text style={s.sheetTitle}>Cancel group order?</Text>
        <Text style={s.sheetBody}>Any paid shares will be refunded via Stripe. This can't be undone.</Text>
        <Pressable onPress={onConfirm} disabled={busy} style={[s.dangerBtnSolid, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.dangerBtnSolidText}>Cancel & refund</Text>}
        </Pressable>
        <Pressable onPress={onCancel} style={s.textBtn}>
          <Text style={s.textBtnText}>Never mind</Text>
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
      <Animated.View entering={SlideInUp} style={s.memberSheet}>
        <View style={s.memberSheetHeader}>
          <View style={[s.avatarMd, { backgroundColor: color }]}>
            <Text style={s.avatarMdText}>{memberInitials(member.display_name)}</Text>
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
            <X size={18} color="#A1A1AA" />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}>
            <ShoppingCart size={22} color="#3F3F46" />
            <Text style={{ color: '#71717A', marginTop: 8, fontSize: 13 }}>
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
  const me = snapshot.members.find((m) => m.id === creds.memberId);
  const myPayment = paymentForMember(snapshot.payments, creds.memberId);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.container}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 80 }}>
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
            <Text style={s.summaryLabel}>Group total</Text>
            <Text style={s.summaryValue}>{formatCents(snapshot.session.total_cents)}</Text>
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

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  centered: { flex: 1, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  errorText: { color: '#A1A1AA', textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FF9933' },
  retryBtnText: { color: '#0f0f0f', fontWeight: '700' },

  joinContainer: { flex: 1, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center', padding: 20 },
  joinCard: { width: '100%', maxWidth: 420, backgroundColor: '#151515', borderRadius: 24, padding: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  joinBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,153,51,0.12)', marginBottom: 12 },
  joinBadgeText: { color: '#FF9933', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  joinTitle: { color: '#F4F4F5', fontSize: 26, fontWeight: '900', lineHeight: 32 },
  joinSubtitle: { color: '#A1A1AA', marginTop: 8, fontSize: 14, lineHeight: 20 },
  nameInput: { marginTop: 18, backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: '#F4F4F5', fontSize: 16 },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12, gap: 8 },
  topTitle: { color: '#F4F4F5', fontWeight: '800', fontSize: 18 },
  topSubtitle: { color: '#A1A1AA', fontSize: 12, marginTop: 2 },

  membersStrip: { maxHeight: 58, marginBottom: 4 },
  memberChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#151515', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  memberChipText: { color: '#F4F4F5', fontSize: 12, fontWeight: '600', maxWidth: 120 },
  memberChipCount: { marginLeft: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,153,51,0.15)', minWidth: 18, alignItems: 'center' },
  memberChipCountText: { color: '#FF9933', fontSize: 10, fontWeight: '800' },
  avatarSm: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarSmText: { color: '#0f0f0f', fontWeight: '800', fontSize: 10 },
  avatarMd: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarMdText: { color: '#0f0f0f', fontWeight: '900', fontSize: 15 },
  crownBadge: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#151515' },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, backgroundColor: '#151515', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  searchInput: { flex: 1, color: '#F4F4F5', paddingVertical: Platform.OS === 'ios' ? 12 : 8 },

  catChip: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#151515', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  catChipActive: { backgroundColor: '#FF9933', borderColor: '#FF9933' },
  catChipText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600', lineHeight: 14 },
  catChipTextActive: { color: '#0f0f0f' },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: '#151515', borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  menuImg: { width: 56, height: 56, borderRadius: 10 },
  menuName: { color: '#F4F4F5', fontWeight: '700', fontSize: 14, flex: 1 },
  menuDesc: { color: '#71717A', fontSize: 12, marginTop: 2 },
  menuPrice: { color: '#FF9933', fontWeight: '800', fontSize: 13, marginTop: 4 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF9933', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  addBtnCount: { position: 'absolute', top: -6, right: -6, backgroundColor: '#0f0f0f', color: '#FF9933', fontSize: 10, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', fontWeight: '800', borderWidth: 1, borderColor: '#FF9933' },

  cartContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#151515', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  cartTitle: { color: '#F4F4F5', fontWeight: '700' },
  cartTotal: { color: '#FF9933', fontWeight: '800', marginLeft: 'auto' },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  cartItemName: { color: '#F4F4F5', fontWeight: '700', fontSize: 13 },
  cartItemMeta: { color: '#71717A', fontSize: 11 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#27272A', alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: '#F4F4F5', fontWeight: '700', width: 22, textAlign: 'center' },

  primaryBtn: { backgroundColor: '#FF9933', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  primaryBtnText: { color: '#0f0f0f', fontWeight: '800', fontSize: 15 },
  secondaryBtn: { backgroundColor: '#151515', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  secondaryBtnText: { color: '#A1A1AA', fontWeight: '700' },
  dangerBtn: { backgroundColor: 'rgba(239,68,68,0.08)', paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' },
  dangerBtnText: { color: '#EF4444', fontWeight: '700' },
  dangerBtnSolid: { backgroundColor: '#EF4444', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  dangerBtnSolidText: { color: '#FFF', fontWeight: '800' },
  textBtn: { paddingVertical: 12, alignItems: 'center' },
  textBtnText: { color: '#71717A' },

  headerCard: { backgroundColor: '#151515', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  summaryLabel: { color: '#71717A', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  summaryValue: { color: '#F4F4F5', fontSize: 32, fontWeight: '900', marginTop: 4 },
  summaryMeta: { color: '#71717A', fontSize: 12, marginTop: 4 },

  sectionLabel: { color: '#F4F4F5', fontWeight: '800', fontSize: 15, marginTop: 22, marginBottom: 10 },

  modeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#151515', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  modeCardActive: { borderColor: '#FF9933', backgroundColor: 'rgba(255,153,51,0.08)' },
  modeTitle: { color: '#F4F4F5', fontWeight: '800', fontSize: 14 },
  modeSubtitle: { color: '#71717A', fontSize: 12, marginTop: 2 },

  assignRow: { backgroundColor: '#151515', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  assignName: { color: '#F4F4F5', fontWeight: '700', marginBottom: 8 },
  assignPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#27272A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', maxWidth: 120 },
  assignPillActive: { backgroundColor: '#FF9933', borderColor: '#FF9933' },
  assignPillText: { color: '#A1A1AA', fontSize: 12, fontWeight: '700' },

  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: '#0f0f0f', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },

  payCta: { marginTop: 16, backgroundColor: '#151515', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,153,51,0.35)' },
  payCtaLabel: { color: '#A1A1AA', fontWeight: '700' },
  payCtaAmount: { color: '#FF9933', fontSize: 24, fontWeight: '900', marginTop: 2 },

  sheetBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#151515', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetTitle: { color: '#F4F4F5', fontSize: 18, fontWeight: '800' },
  sheetBody: { color: '#A1A1AA', marginTop: 8 },

  memberSheet: { backgroundColor: '#151515', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  memberSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  memberSheetTitle: { color: '#F4F4F5', fontSize: 16, fontWeight: '800' },
  memberSheetSubtitle: { color: '#A1A1AA', fontSize: 12, marginTop: 2, fontWeight: '600' },
  memberSheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  memberSheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  memberSheetItemName: { color: '#F4F4F5', fontSize: 14, fontWeight: '700' },
  memberSheetNote: { color: '#71717A', fontSize: 12, marginTop: 2 },
  memberSheetPrice: { color: '#FF9933', fontSize: 14, fontWeight: '800' },

  successBadgeWrapper: { width: 72, height: 72, marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  successBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,153,51,0.12)', alignItems: 'center', justifyContent: 'center' },
  cancelledBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  pulseRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: 'rgba(255,153,51,0.6)' },
  successTitle: { color: '#F4F4F5', fontWeight: '900', fontSize: 24 },
  successSubtitle: { color: '#A1A1AA', textAlign: 'center', marginTop: 6 },
  receiptCard: { marginTop: 16, backgroundColor: '#151515', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  receiptLabel: { color: '#71717A', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  receiptName: { color: '#F4F4F5', fontSize: 18, fontWeight: '800', marginTop: 4 },
  receiptAmount: { color: '#FF9933', fontWeight: '800', marginTop: 4 },
});
