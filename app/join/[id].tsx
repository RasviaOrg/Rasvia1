import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
    View, Text, TextInput, FlatList, SectionList,
    Alert, ActivityIndicator, Modal, Platform, ScrollView, KeyboardAvoidingView,
    Pressable, Image, Share,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useNotifications } from '../../lib/notifications-context';
import { useAuth } from '../../lib/auth-context';
import { isInvalidJwtEdgeFunctionError, parseEdgeFunctionError } from '../../lib/edge-function-error';
import { withTimeout } from '../../lib/with-timeout';
import { getCheckoutUrlOrThrow } from '../../lib/checkout-response';
import {
    ArrowLeft, ShoppingCart, Plus, Minus, X, Coffee, Sun, Moon,
    Star, Clock, Leaf, Flame, ChevronDown, ChevronUp,
    CheckCircle2, Users, DollarSign, Trash2, Send,
    Crown, Search, Filter, CreditCard, Share2,
    Truck, UtensilsCrossed, Wallet, SlidersHorizontal,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, FadeInUp } from 'react-native-reanimated';

type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'specials' | 'all_day';

const MEAL_PERIOD_CFG: Record<MealPeriod, { label: string; color: string; bg: string; border: string; Icon: any }> = {
    breakfast: { label: 'Breakfast', color: '#F97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.35)', Icon: Coffee },
    lunch: { label: 'Lunch', color: '#22C55E', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.35)', Icon: Sun },
    dinner: { label: 'Dinner', color: '#818CF8', bg: 'rgba(129,140,248,0.15)', border: 'rgba(129,140,248,0.35)', Icon: Moon },
    specials: { label: 'Specials', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)', Icon: Star },
    all_day: { label: 'All Day', color: '#94A3B8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.35)', Icon: Clock },
};

const MEMBER_COLORS = ['#FF9933', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'];
const GROUP_ORDER_WEB_BASE_URL = "https://rasvia.com";
const PAYMENT_REQUEST_TIMEOUT_MS = 15000;
type PaymentMode = 'host_pays' | 'split' | 'assign';
const SPLIT_META_PREFIX = '__rasvia_split:';
type ItemSplitMeta = { type: 'equal'; members: string[] };

function normalizePaymentMode(mode: unknown): PaymentMode {
    return mode === 'split' || mode === 'assign' || mode === 'host_pays' ? mode : 'host_pays';
}

function isWaitlistFullError(error: any): boolean {
    const text = String(error?.message || error?.details || error?.hint || '').toUpperCase();
    return text.includes('WAITLIST_FULL') || text.includes('WAITLIST IS CURRENTLY FULL');
}

function parseItemSplitMeta(raw: unknown): ItemSplitMeta | null {
    if (typeof raw !== 'string' || !raw.startsWith(SPLIT_META_PREFIX)) return null;
    try {
        const parsed = JSON.parse(raw.slice(SPLIT_META_PREFIX.length));
        if (!parsed || parsed.type !== 'equal' || !Array.isArray(parsed.members)) return null;
        const members = parsed.members
            .map((m: unknown) => String(m || '').trim())
            .filter(Boolean);
        if (members.length === 0) return null;
        return { type: 'equal', members: Array.from(new Set(members)) };
    } catch {
        return null;
    }
}

function MealPeriodTag({ period }: { period: MealPeriod }) {
    const cfg = MEAL_PERIOD_CFG[period];
    if (!cfg) return null;
    const Icon = cfg.Icon;
    return (
        <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            backgroundColor: cfg.bg, borderRadius: 20, borderWidth: 1,
            borderColor: cfg.border, paddingHorizontal: 10, paddingVertical: 4,
        }}>
            <Icon size={11} color={cfg.color} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: cfg.color, fontSize: 11 }}>
                {cfg.label}
            </Text>
        </View>
    );
}

function getMemberColor(name: string, allNames: string[]): string {
    const idx = allNames.indexOf(name);
    return MEMBER_COLORS[idx % MEMBER_COLORS.length];
}

function MemberAvatar({ name, color, size, avatarUrl }: { name: string; color: string; size: number; avatarUrl?: string | null }) {
    const borderR = size / 2;
    if (avatarUrl) {
        return (
            <Image
                source={{ uri: avatarUrl }}
                style={{ width: size, height: size, borderRadius: borderR, borderWidth: 2, borderColor: color }}
            />
        );
    }
    return (
        <View style={{ width: size, height: size, borderRadius: borderR, backgroundColor: `${color}20`, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color, fontSize: size * 0.38 }}>{name.charAt(0).toUpperCase()}</Text>
        </View>
    );
}

export default function JoinPartyScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { addEvent } = useNotifications();
    const { session } = useAuth();

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };

    const [guestName, setGuestName] = useState('');
    const [isJoined, setIsJoined] = useState(false);
    const [loading, setLoading] = useState(true);
    const [menu, setMenu] = useState<any[]>([]);
    const [cartItems, setCartItems] = useState<any[]>([]);
    const [restaurantName, setRestaurantName] = useState('');
    const [restaurantImage, setRestaurantImage] = useState<string | null>(null);
    const [restaurantId, setRestaurantId] = useState<number | null>(null);
    const [showCartModal, setShowCartModal] = useState(false);
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [sessionError, setSessionError] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [showMemberBreakdown, setShowMemberBreakdown] = useState(true);
    const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
    const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);

    // ── Group Order Type & Payment Mode ──
    const [groupOrderType, setGroupOrderType] = useState<'dine_in' | 'takeout'>('dine_in');
    const [groupPartySize, setGroupPartySize] = useState(2);
    const [paymentMode, setPaymentMode] = useState<PaymentMode>('host_pays');
    const [assignedPayer, setAssignedPayer] = useState<string | null>(null);
    const [paymentModeSyncing, setPaymentModeSyncing] = useState(false);
    const [payingMyShare, setPayingMyShare] = useState(false);
    const [splitPaidMembers, setSplitPaidMembers] = useState<string[]>([]);
    const [splitEditItem, setSplitEditItem] = useState<any | null>(null);
    const [showMemberSplitOverlay, setShowMemberSplitOverlay] = useState(false);
    const [splitSelectedMembers, setSplitSelectedMembers] = useState<string[]>([]);
    const [savingSplitDraft, setSavingSplitDraft] = useState(false);

    const channelRef = useRef<any>(null);
    const fetchCartRef = useRef<() => Promise<void>>(async () => { });
    const sessionId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
    const userId = session?.user?.id ?? '';
    const closeCartModal = useCallback(() => {
        if (Platform.OS !== "web") Haptics.selectionAsync();
        setSplitEditItem(null);
        setShowMemberSplitOverlay(false);
        setSplitSelectedMembers([]);
        setShowCartModal(false);
    }, []);

    // User-scoped storage keys so multiple accounts on one device never collide
    const nameKey = userId ? `party_name_${userId}_${sessionId}` : `party_name_anon_${sessionId}`;
    const activeOrderKey = userId ? `rasvia_active_group_order_${userId}` : 'rasvia_active_group_order_anon';

    const totalItems = cartItems.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
    const totalPrice = cartItems.reduce((sum, item) => {
        const price = item.menu_items?.price ?? item.price ?? 0;
        return sum + Number(price) * (item.quantity ?? 1);
    }, 0);

    const uniqueMembers = useMemo(() => {
        const names = new Set<string>();
        cartItems.forEach(item => { if (item.added_by_name) names.add(item.added_by_name); });
        return Array.from(names);
    }, [cartItems]);

    const normalizeMemberName = useCallback((name: string) => name.trim().toLowerCase(), []);
    const splitPaidMemberSet = useMemo(
        () => new Set(splitPaidMembers.map((name) => normalizeMemberName(name))),
        [splitPaidMembers, normalizeMemberName]
    );
    const memberUserIdMap = useMemo<Record<string, string>>(() => {
        const out: Record<string, string> = {};
        cartItems.forEach((item) => {
            const name = String(item.added_by_name || '').trim();
            if (!name) return;
            const userId = typeof item.added_by_user_id === 'string' ? item.added_by_user_id : '';
            if (userId && !out[name]) out[name] = userId;
        });
        return out;
    }, [cartItems]);
    const membersWithAppIdentity = useMemo(
        () => uniqueMembers.filter((name) => !!memberUserIdMap[name]),
        [uniqueMembers, memberUserIdMap]
    );
    const assignableMembers = useMemo(() => {
        const set = new Set(membersWithAppIdentity);
        if (guestName && userId && uniqueMembers.includes(guestName)) {
            set.add(guestName);
        }
        return Array.from(set);
    }, [guestName, membersWithAppIdentity, uniqueMembers, userId]);

    // Avatar map: name → url (only populated for current user right now)
    const memberAvatarMap = useMemo<Record<string, string | null>>(() => {
        if (!guestName || !userAvatarUrl) return {};
        return { [guestName]: userAvatarUrl };
    }, [guestName, userAvatarUrl]);

    const memberTotals = useMemo(() => {
        const totals: Record<string, { items: any[]; total: number }> = {};
        uniqueMembers.forEach((name) => {
            totals[name] = { items: [], total: 0 };
        });

        cartItems.forEach(item => {
            const owner = String(item.added_by_name || 'Unknown');
            const unitPrice = Number(item.menu_items?.price ?? item.price ?? 0);
            const qty = Math.max(1, Number(item.quantity ?? 1));
            const totalCents = Math.max(0, Math.round(unitPrice * qty * 100));
            const splitMeta = parseItemSplitMeta(item.special_requests);
            const splitMembers = splitMeta?.members?.filter((m) => uniqueMembers.includes(m)) ?? [];
            const payers = splitMembers.length >= 2 ? splitMembers : [owner];
            const base = Math.floor(totalCents / payers.length);
            let remainder = totalCents - base * payers.length;

            payers.forEach((name) => {
                if (!totals[name]) totals[name] = { items: [], total: 0 };
                const cents = base + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder -= 1;
                totals[name].total += cents / 100;
                totals[name].items.push({
                    ...item,
                    __allocatedCents: cents,
                    __splitMembers: payers,
                });
            });
        });
        return totals;
    }, [cartItems, uniqueMembers]);
    const splitRequiredMembers = useMemo(
        () => uniqueMembers.filter((name) => (memberTotals[name]?.total ?? 0) > 0),
        [uniqueMembers, memberTotals]
    );
    const canUseMultiPayerModes = uniqueMembers.length > 1;
    const splitAllPaid = useMemo(
        () => splitRequiredMembers.every((name) => splitPaidMemberSet.has(normalizeMemberName(name))),
        [splitRequiredMembers, splitPaidMemberSet, normalizeMemberName]
    );
    const unpaidSplitMembers = useMemo(
        () => splitRequiredMembers.filter((name) => !splitPaidMemberSet.has(normalizeMemberName(name))),
        [splitRequiredMembers, splitPaidMemberSet, normalizeMemberName]
    );
    const myShareTotal = guestName ? (memberTotals[guestName]?.total ?? 0) : 0;
    const mySharePaid = guestName ? splitPaidMemberSet.has(normalizeMemberName(guestName)) : false;
    const isAssignedPayerValid = paymentMode !== 'assign' || (!!assignedPayer && assignableMembers.includes(assignedPayer));

    const combinedAllItems = useMemo(() => {
        const combined = new Map<string, {
            id: string;
            name: string;
            quantity: number;
            total: number;
            contributors: Set<string>;
        }>();

        cartItems.forEach((item, index) => {
            const itemName = item.menu_items?.name ?? item.name ?? 'Item';
            const unitPrice = Number(item.menu_items?.price ?? item.price ?? 0);
            const qty = item.quantity ?? 1;
            const key = item.menu_item_id != null ? `id:${item.menu_item_id}` : `name:${itemName.toLowerCase()}:${unitPrice}`;
            const existing = combined.get(key);

            if (existing) {
                existing.quantity += qty;
                existing.total += unitPrice * qty;
                if (item.added_by_name) existing.contributors.add(item.added_by_name);
            } else {
                combined.set(key, {
                    id: item.id?.toString?.() ?? `combined-${index}`,
                    name: itemName,
                    quantity: qty,
                    total: unitPrice * qty,
                    contributors: new Set(item.added_by_name ? [item.added_by_name] : []),
                });
            }
        });

        return Array.from(combined.values());
    }, [cartItems]);

    const menuCategories = useMemo(() => {
        const cats = new Set<string>();
        menu.forEach(item => {
            if (item.meal_period) cats.add(item.meal_period);
        });
        return ['all', ...Array.from(cats)];
    }, [menu]);

    const filteredMenu = useMemo(() => {
        let filtered = menu;
        if (selectedCategory !== 'all') {
            filtered = filtered.filter(item => item.meal_period === selectedCategory);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(item =>
                item.name?.toLowerCase().includes(q) ||
                item.description?.toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [menu, selectedCategory, searchQuery]);

    useEffect(() => {
        if (showCartModal) return;
        setSplitEditItem(null);
        setShowMemberSplitOverlay(false);
        setSplitSelectedMembers([]);
    }, [showCartModal]);

    // Cart fetcher stored in a ref so subscriptions always call the latest version
    // without causing effect dependency changes
    const doFetchCart = useCallback(async () => {
        if (!sessionId) return;
        try {
            const { data } = await supabase
                .from('party_items')
                .select('*, menu_items(name, price, description, image_url)')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true });
            setCartItems(data ?? []);
        } catch {
            // silently ignore cart fetch errors
        }
    }, [sessionId]);

    const fetchSplitPaidMembers = useCallback(async () => {
        if (!sessionId) return;
        try {
            const { data } = await supabase
                .from('orders')
                .select('customer_name,status,party_session_id')
                .eq('party_session_id', sessionId)
                .in('status', ['paid', 'ready', 'served']);

            const paid = Array.from(
                new Set(
                    (data ?? [])
                        .map((row: any) => String(row?.customer_name ?? '').trim())
                        .filter(Boolean)
                )
            );
            setSplitPaidMembers(paid);
        } catch {
            // ignore; split payment state will remain best-effort
        }
    }, [sessionId]);

    const openSplitEditor = useCallback((item: any) => {
        const fallbackOwner = String(item?.added_by_name || '').trim();
        const splitMeta = parseItemSplitMeta(item?.special_requests);
        const selected = splitMeta?.members?.filter((name) => uniqueMembers.includes(name))
            ?? (fallbackOwner ? [fallbackOwner] : []);
        setSplitSelectedMembers(Array.from(new Set(selected)));
        setSplitEditItem(item);
    }, [uniqueMembers]);

    const saveSplitEditor = useCallback(async () => {
        if (!splitEditItem || !sessionId || !isHost) return;
        const selected = Array.from(new Set(splitSelectedMembers.map((name) => String(name || '').trim()).filter(Boolean)));
        if (selected.length === 0) {
            Alert.alert('Invalid Split', 'Select at least one member.');
            return;
        }
        const splitMetaValue = selected.length >= 2
            ? `${SPLIT_META_PREFIX}${JSON.stringify({ type: 'equal', members: selected })}`
            : null;

        setSavingSplitDraft(true);
        try {
            const { error: updateErr } = await supabase
                .from('party_items')
                .update({
                    special_requests: splitMetaValue,
                })
                .eq('id', splitEditItem.id);
            if (updateErr) throw updateErr;

            setSplitEditItem(null);
            setSplitSelectedMembers([]);
            await doFetchCart();
        } catch (e: any) {
            Alert.alert('Split Update Failed', e?.message || 'Could not save split changes.');
        } finally {
            setSavingSplitDraft(false);
        }
    }, [doFetchCart, isHost, sessionId, splitEditItem, splitSelectedMembers]);

    fetchCartRef.current = doFetchCart;

    // Initialize party session data — runs when sessionId + userId are available.
    // Uses auth-context session (local, always in sync) instead of getUser() (network call).
    useEffect(() => {
        if (!sessionId) {
            setLoading(false);
            return;
        }

        let active = true;

        const init = async () => {
            try {
                // Read the user-scoped name for this session
                const storedName = await SecureStore.getItemAsync(nameKey);
                if (storedName) {
                    setGuestName(storedName);
                    setIsJoined(true);
                }

                const { data: sess, error } = await supabase
                    .from('party_sessions')
                    .select('restaurant_id, host_user_id, status, payment_mode, assigned_payer_name, restaurants(name, image_url)')
                    .eq('id', sessionId)
                    .single();

                if (error || !sess) {
                    setSessionError(true);
                    return;
                }

                if (sess.status === 'submitted') setSubmitted(true);
                if (sess.status === 'cancelled') { setSessionError(true); return; }
                setRestaurantId(sess.restaurant_id);
                setPaymentMode(normalizePaymentMode((sess as any).payment_mode));
                setAssignedPayer((sess as any).assigned_payer_name ?? null);

                // Host detection: compare against the locally-available session user
                const currentUserId = userId;
                if (currentUserId && sess.host_user_id === currentUserId) {
                    setIsHost(true);
                    if (!storedName) {
                        const { data: profile } = await supabase
                            .from('profiles')
                            .select('full_name, avatar_url')
                            .eq('id', currentUserId)
                            .single();
                        const hostName = profile?.full_name || 'Host';
                        setGuestName(hostName);
                        setIsJoined(true);
                        SecureStore.setItemAsync(nameKey, hostName);
                        if ((profile as any)?.avatar_url) setUserAvatarUrl((profile as any).avatar_url);
                    } else {
                        // Still fetch avatar for existing host
                        supabase.from('profiles').select('avatar_url').eq('id', currentUserId).single()
                            .then(({ data }) => { if ((data as any)?.avatar_url) setUserAvatarUrl((data as any).avatar_url); });
                    }
                } else if (currentUserId) {
                    // Guest member — still fetch their avatar
                    supabase.from('profiles').select('avatar_url').eq('id', currentUserId).single()
                        .then(({ data }) => { if ((data as any)?.avatar_url) setUserAvatarUrl((data as any).avatar_url); });
                }

                const rest = sess.restaurants as any;
                setRestaurantName(rest?.name ?? 'Restaurant');
                setRestaurantImage(rest?.image_url ?? null);

                const { data: menuItems } = await supabase
                    .from('menu_items')
                    .select('*')
                    .eq('restaurant_id', sess.restaurant_id)
                    .neq('is_available', false);

                setMenu(menuItems ?? []);

                const { data: cartData } = await supabase
                    .from('party_items')
                    .select('*, menu_items(name, price, description, image_url)')
                    .eq('session_id', sessionId)
                    .order('created_at', { ascending: true });

                setCartItems(cartData ?? []);
                fetchSplitPaidMembers();
            } catch (e) {
                console.error('initializeParty error:', e);
                if (active) setSessionError(true);
            } finally {
                if (active) setLoading(false);
            }
        };

        init();
        return () => { active = false; };
    }, [sessionId, userId, nameKey, fetchSplitPaidMembers]);

    // Real-time subscriptions — only depends on sessionId (stable string)
    // Uses ref for fetchCart so it never causes re-subscription
    useEffect(() => {
        if (!sessionId) return;

        const channel = supabase
            .channel(`party-live-${sessionId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'party_items', filter: `session_id=eq.${sessionId}` },
                () => { fetchCartRef.current?.(); }
            )
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'party_sessions', filter: `id=eq.${sessionId}` },
                (payload) => {
                    const nextSession = payload.new as Record<string, unknown>;
                    if (nextSession?.status === 'submitted') setSubmitted(true);
                    setPaymentMode(normalizePaymentMode(nextSession?.payment_mode));
                    setAssignedPayer(typeof nextSession?.assigned_payer_name === 'string' ? nextSession.assigned_payer_name : null);
                }
            )
            .subscribe();

        channelRef.current = channel;

        return () => {
            supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        const paymentsChannel = supabase
            .channel(`party-payments-${sessionId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'orders', filter: `party_session_id=eq.${sessionId}` },
                () => {
                    fetchSplitPaidMembers();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(paymentsChannel);
        };
    }, [fetchSplitPaidMembers, sessionId]);

    // Refs for deep-link handler to avoid re-subscribing on cart changes
    const cartItemsRef = useRef(cartItems);
    cartItemsRef.current = cartItems;
    const restaurantNameRef = useRef(restaurantName);
    restaurantNameRef.current = restaurantName;
    const restaurantIdRef = useRef(restaurantId);
    restaurantIdRef.current = restaurantId;

    // Deep-link handler: rasvia://checkout/success|cancel|error
    useEffect(() => {
        const handleUrl = async (event: { url: string }) => {
            const { path, queryParams } = Linking.parse(event.url);

            if (path === 'checkout/success' || path === 'order-confirmation') {
                setSubmitted(true);
                setShowCartModal(false);
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

                addEvent({
                    type: 'group_submitted',
                    restaurantName: restaurantNameRef.current,
                    restaurantId: String(restaurantIdRef.current),
                    entryId: String(sessionId),
                    partySize: cartItemsRef.current.length,
                    timestamp: new Date().toISOString(),
                });
                SecureStore.deleteItemAsync(activeOrderKey);
            } else if (path === 'checkout/cancel') {
                setShowCartModal(false);
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                Alert.alert(
                    'Payment Cancelled',
                    'Your payment was not processed. You can try again when you\'re ready.',
                );
            } else if (path === 'checkout/error') {
                setShowCartModal(false);
                const reason = (queryParams as any)?.reason || 'unknown';
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert(
                    'Payment Error',
                    reason === 'payment_incomplete'
                        ? 'Your payment could not be confirmed. Please check your card details and try again.'
                        : `Something went wrong with your payment. Please try again.\n\nDetails: ${reason}`,
                );
            }
        };

        const subscription = Linking.addEventListener('url', handleUrl);

        Linking.getInitialURL().then(url => {
            if (url) handleUrl({ url });
        });

        return () => subscription.remove();
    }, [sessionId]);

    // Persist session ID so home page can find it (user-scoped)
    useEffect(() => {
        if (sessionId && isJoined && restaurantName && userId) {
            SecureStore.setItemAsync(activeOrderKey, JSON.stringify({
                sessionId,
                restaurantName,
                isHost,
                joinedAt: new Date().toISOString(),
            }));
        }
    }, [sessionId, isJoined, restaurantName, isHost, userId, activeOrderKey]);

    const handleJoin = async () => {
        if (!guestName.trim()) return;
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await SecureStore.setItemAsync(nameKey, guestName.trim());
        setGuestName(guestName.trim());
        setIsJoined(true);
        if (!isHost) {
            addEvent({
                type: 'group_joined',
                restaurantName,
                restaurantId: String(restaurantId),
                entryId: String(sessionId),
                partySize: 1,
                timestamp: new Date().toISOString(),
            });
        }
    };

    const addToCart = async (item: any, quantity: number = 1) => {
        if (submitted) return;
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const existing = cartItems.find(
            (ci) =>
                ci.menu_item_id === item.id &&
                String(ci.added_by_name || '').trim() === guestName.trim() &&
                !String(ci.id).startsWith('temp-')
        );

        if (existing) {
            const nextQty = (existing.quantity ?? 1) + quantity;
            setCartItems(prev => prev.map(ci => ci.id === existing.id ? { ...ci, quantity: nextQty } : ci));
            const { error } = await supabase
                .from('party_items')
                .update({ quantity: nextQty })
                .eq('id', existing.id);
            if (error) {
                doFetchCart();
                Alert.alert('Error', 'Could not add item. Please try again.');
            }
        } else {
            const tempId = `temp-${Math.random()}`;
            const optimistic = {
                id: tempId,
                menu_item_id: item.id,
                menu_items: { name: item.name, price: item.price, description: item.description, image_url: item.image_url },
                added_by_name: guestName,
                quantity,
            };
            setCartItems(prev => [...prev, optimistic]);

            const insertPayload: Record<string, any> = {
                session_id: sessionId,
                menu_item_id: item.id,
                added_by_name: guestName,
                quantity,
                added_by_user_id: userId || null,
            };
            let { error } = await supabase.from('party_items').insert(insertPayload);
            if (error) {
                const { added_by_user_id, ...fallbackPayload } = insertPayload;
                const fallback = await supabase.from('party_items').insert(fallbackPayload);
                error = fallback.error;
            }

            if (error) {
                setCartItems(prev => prev.filter(i => i.id !== tempId));
                Alert.alert('Error', 'Could not add item. Please try again.');
            }
        }
        // Reset the quantity selector
        setItemQuantities(prev => { const n = { ...prev }; delete n[item.id.toString()]; return n; });
    };

    const removeFromCart = async (itemId: string) => {
        if (submitted) return;
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        setCartItems(prev => prev.filter(i => i.id !== itemId));

        if (!itemId.startsWith('temp-')) {
            const { error } = await supabase.from('party_items').delete().eq('id', itemId);
            if (error) doFetchCart();
        }
    };

    const cancelGroupOrder = async () => {
        Alert.alert(
            'Cancel Group Order',
            'This will discard the entire group order and all items. Everyone in the group will be removed.\n\nThis cannot be undone.',
            [
                { text: 'Keep Order', style: 'cancel' },
                {
                    text: 'Cancel Order',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await supabase.from('party_items').delete().eq('session_id', sessionId);
                            await supabase.from('party_sessions').update({ status: 'cancelled' }).eq('id', sessionId);
                            await SecureStore.deleteItemAsync(activeOrderKey);
                            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                            addEvent({
                                type: 'group_ended',
                                restaurantName,
                                restaurantId: String(restaurantId),
                                entryId: String(sessionId),
                                partySize: cartItems.length,
                                timestamp: new Date().toISOString(),
                            });
                            goBack();
                        } catch (e: any) {
                            Alert.alert('Error', e.message || 'Could not cancel order.');
                        }
                    },
                },
            ]
        );
    };

    // ── Internal helper: mark session submitted in DB and fire events ──────
    const finaliseSubmit = async () => {
        const { error } = await supabase
            .from('party_sessions')
            .update({ status: 'submitted', submitted_at: new Date().toISOString() })
            .eq('id', sessionId);
        if (error) throw error;

        const orderSummary = cartItems.map(ci => ({
            name: ci.menu_items?.name ?? 'Unknown',
            price: Number(ci.menu_items?.price ?? 0),
            quantity: ci.quantity ?? 1,
            added_by: ci.added_by_name,
        }));

        await supabase.from('group_orders').insert({
            party_session_id: sessionId,
            restaurant_id: restaurantId,
            items: orderSummary,
            total: totalPrice,
            submitted_at: new Date().toISOString(),
        }).then(() => { });

        setSubmitted(true);
        setShowCartModal(false);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        addEvent({
            type: 'group_submitted',
            restaurantName,
            restaurantId: String(restaurantId),
            entryId: String(sessionId),
            partySize: cartItems.length,
            timestamp: new Date().toISOString(),
        });

        SecureStore.deleteItemAsync(activeOrderKey);

        // If dine-in group order, add to waitlist automatically
        if (groupOrderType === 'dine_in' && restaurantId) {
            try {
                const [{ data: restData }, { count: activeCount }] = await Promise.all([
                    supabase
                        .from('restaurants')
                        .select('max_waitlist_size')
                        .eq('id', restaurantId)
                        .maybeSingle(),
                    supabase
                        .from('waitlist_entries')
                        .select('id', { count: 'exact', head: true })
                        .eq('restaurant_id', restaurantId)
                        .in('status', ['waiting', 'notified']),
                ]);
                const maxWaitlistSize = Math.max(1, Math.min(200, Number((restData as any)?.max_waitlist_size) || 15));
                if ((activeCount ?? 0) >= maxWaitlistSize) {
                    Alert.alert(
                        'Waitlist Full',
                        'This waitlist is currently full. Please call the restaurant directly for the latest availability.'
                    );
                    return;
                }

                const { data: entry } = await supabase
                    .from('waitlist_entries')
                    .insert({
                        restaurant_id: restaurantId,
                        party_name: guestName || 'Group Order',
                        party_size: groupPartySize || uniqueMembers.length || 2,
                        status: 'waiting',
                        user_id: userId || null,
                    })
                    .select('id')
                    .single();

                if (entry) {
                    router.push(`/waitlist/${restaurantId}?entry_id=${entry.id}&party_size=${groupPartySize}` as any);
                }
            } catch (e: any) {
                if (isWaitlistFullError(e)) {
                    Alert.alert(
                        'Waitlist Full',
                        'This waitlist is currently full. Please call the restaurant directly for the latest availability.'
                    );
                } else {
                    console.error('Waitlist auto-add error:', e);
                }
            }
        }
    };

    const syncPaymentModeToSession = useCallback(async (nextMode: PaymentMode, nextAssignedPayer: string | null) => {
        if (paymentModeSyncing) return;
        if ((nextMode === 'split' || nextMode === 'assign') && !canUseMultiPayerModes) return;
        setPaymentModeSyncing(true);
        setPaymentMode(nextMode);
        setAssignedPayer(nextAssignedPayer);

        if (!isHost || !sessionId) {
            setPaymentModeSyncing(false);
            return;
        }

        const { error } = await supabase
            .from('party_sessions')
            .update({
                payment_mode: nextMode,
                assigned_payer_name: nextMode === 'assign' ? nextAssignedPayer : null,
            })
            .eq('id', sessionId);

        if (error) {
            setPaymentModeSyncing(false);
            throw error;
        }
        setPaymentModeSyncing(false);
    }, [canUseMultiPayerModes, isHost, paymentModeSyncing, sessionId]);

    useEffect(() => {
        if (canUseMultiPayerModes) return;
        if (paymentMode === 'host_pays') return;
        setPaymentMode('host_pays');
        setAssignedPayer(null);
        if (isHost && sessionId) {
            supabase
                .from('party_sessions')
                .update({ payment_mode: 'host_pays', assigned_payer_name: null })
                .eq('id', sessionId)
                .then(() => { });
        }
    }, [canUseMultiPayerModes, isHost, paymentMode, sessionId]);

    const buildCartMetaForPayer = useCallback((payerName?: string) => {
        if (!payerName) {
            return cartItems.map((ci) => ({
                name: ci.menu_items?.name ?? 'Unknown',
                price: Number(ci.menu_items?.price ?? 0),
                quantity: ci.quantity ?? 1,
                menu_item_id: ci.menu_item_id,
                is_vegetarian: ci.menu_items?.is_vegetarian ?? false,
                added_by: ci.added_by_name || guestName || '',
            }));
        }

        const payerItems = cartItems.flatMap((ci) => {
            const owner = String(ci.added_by_name || '');
            const splitMeta = parseItemSplitMeta(ci.special_requests);
            const splitMembers = splitMeta?.members?.filter((m) => uniqueMembers.includes(m)) ?? [];
            const payers = splitMembers.length >= 2 ? splitMembers : [owner];
            if (!payers.includes(payerName)) return [];

            const totalCents = Math.max(0, Math.round(Number(ci.menu_items?.price ?? ci.price ?? 0) * Math.max(1, Number(ci.quantity ?? 1)) * 100));
            const base = Math.floor(totalCents / payers.length);
            let remainder = totalCents - base * payers.length;
            let payerCents = 0;
            payers.forEach((name) => {
                const cents = base + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder -= 1;
                if (name === payerName) payerCents = cents;
            });

            return [{
                name: payers.length >= 2 ? `${ci.menu_items?.name ?? 'Unknown'} (split)` : (ci.menu_items?.name ?? 'Unknown'),
                price: payerCents / 100,
                quantity: 1,
                menu_item_id: ci.menu_item_id,
                is_vegetarian: ci.menu_items?.is_vegetarian ?? false,
                added_by: payerName,
            }];
        });

        return payerItems.filter((item) => item.price > 0);
    }, [cartItems, guestName, uniqueMembers]);

    const createCheckoutSessionUrl = useCallback(async (requestBody: Record<string, unknown>) => {
        const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
        const invokeCreateCheckout = (authToken: string) =>
            withTimeout(
                supabase.functions.invoke(
                    'create-checkout',
                    {
                        body: requestBody,
                        headers: {
                            Authorization: `Bearer ${authToken}`,
                            ...(anonKey ? { apikey: anonKey } : {}),
                        },
                    }
                ),
                PAYMENT_REQUEST_TIMEOUT_MS,
                'Request timed out while creating checkout. Please try again.'
            );

        const invokeCreateCheckoutWithAnonFetch = async () => {
            if (!anonKey || !supabaseUrl) {
                throw new Error('Supabase configuration is missing for checkout.');
            }
            const response = await withTimeout(
                fetch(`${supabaseUrl}/functions/v1/create-checkout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${anonKey}`,
                        apikey: anonKey,
                    },
                    body: JSON.stringify(requestBody),
                }),
                PAYMENT_REQUEST_TIMEOUT_MS,
                'Request timed out while creating checkout. Please try again.'
            );

            const raw = await response.text();
            let parsed: any = null;
            try { parsed = raw ? JSON.parse(raw) : null; } catch { }

            if (!response.ok) {
                const msg = parsed?.error || parsed?.message || raw || `Checkout request failed (${response.status}).`;
                throw new Error(msg);
            }

            return parsed;
        };

        const { data: sessionData, error: sessionErr } = await withTimeout(
            supabase.auth.getSession(),
            PAYMENT_REQUEST_TIMEOUT_MS,
            'Request timed out while validating your session. Please reopen the app and try again.'
        );
        const accessToken = sessionData?.session?.access_token;

        let fnData: any = null;
        let fnError: any = null;

        if (accessToken && !sessionErr) {
            const invokeResult = await invokeCreateCheckout(accessToken);
            fnData = invokeResult.data;
            fnError = invokeResult.error;

            if (fnError) {
                const fnErrorDetails = await parseEdgeFunctionError(fnError);
                if (isInvalidJwtEdgeFunctionError(fnErrorDetails)) {
                    const { data: retrySessionData, error: retrySessionErr } = await withTimeout(
                        supabase.auth.getSession(),
                        PAYMENT_REQUEST_TIMEOUT_MS,
                        'Request timed out while validating your session. Please reopen the app and try again.'
                    );
                    const retryToken = retrySessionData?.session?.access_token;
                    if (!retrySessionErr && retryToken) {
                        const retryResult = await invokeCreateCheckout(retryToken);
                        fnData = retryResult.data;
                        fnError = retryResult.error;
                    }
                }
            }
        }

        if (fnError) {
            const postRetryDetails = await parseEdgeFunctionError(fnError);
            if (isInvalidJwtEdgeFunctionError(postRetryDetails) && anonKey) {
                fnData = await invokeCreateCheckoutWithAnonFetch();
                fnError = null;
            }
        } else if (!fnData && anonKey) {
            fnData = await invokeCreateCheckoutWithAnonFetch();
        }

        if (fnError) throw fnError;

        return getCheckoutUrlOrThrow(fnData);
    }, []);

    const handlePayMyShare = useCallback(async () => {
        if (!sessionId || !restaurantId || !guestName || myShareTotal <= 0) return;
        if (Platform.OS !== "web") Haptics.selectionAsync();

        setPayingMyShare(true);
        try {
            const restResponse: any = await withTimeout(
                (supabase
                    .from('restaurants')
                    .select('stripe_account_id')
                    .eq('id', restaurantId)
                    .single()) as any,
                PAYMENT_REQUEST_TIMEOUT_MS,
                'Request timed out while loading payment settings.'
            );
            const { data: restData, error: restError } = restResponse;

            if (restError) throw restError;

            const stripeAccountId = restData?.stripe_account_id;
            if (!stripeAccountId) {
                throw new Error('Online payments are not available for this restaurant yet.');
            }

            const payerItems = buildCartMetaForPayer(guestName);
            if (payerItems.length === 0) {
                throw new Error('No items found for your share.');
            }

            const returnBase = `rasvia://join/${sessionId}?split_paid=1&payer=${encodeURIComponent(guestName)}`;
            const checkoutUrl = await createCheckoutSessionUrl({
                restaurant_id: restaurantId,
                stripe_account_id: stripeAccountId,
                amount: myShareTotal,
                party_session_id: sessionId,
                cart_items: payerItems,
                restaurant_name: restaurantName,
                customer_name: guestName,
                user_id: session?.user?.id ?? null,
                order_type: groupOrderType,
                return_url_base: returnBase,
            });

            const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'rasvia://');
            if (result.type === 'success' && result.url) {
                const rawUrl = result.url;
                const qIndex = rawUrl.indexOf('?');
                const qString = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
                const sp = new URLSearchParams(qString);

                if (rawUrl.includes('checkout/cancel') || sp.get('checkout_status') === 'cancel') {
                    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    Alert.alert('Payment Cancelled', 'Your payment was not processed.');
                } else if (rawUrl.includes('checkout/error') || sp.get('checkout_status') === 'error') {
                    const reason = sp.get('reason') || 'unknown';
                    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    Alert.alert('Payment Error', `Something went wrong. ${reason}`);
                } else {
                    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Payment Complete', `You paid $${myShareTotal.toFixed(2)} for your items.`);
                    fetchSplitPaidMembers();
                }
            }
        } catch (e: unknown) {
            const parsedError = await parseEdgeFunctionError(
                e,
                'Could not initiate payment.'
            );
            console.error('Group member payment error:', parsedError, e);
            Alert.alert('Payment Error', parsedError.message);
        } finally {
            setPayingMyShare(false);
        }
    }, [buildCartMetaForPayer, createCheckoutSessionUrl, fetchSplitPaidMembers, guestName, groupOrderType, myShareTotal, restaurantId, restaurantName, session?.user?.id, sessionId]);

    // ── Main Pay / Submit handler ────────────────────────────────────────
    const handlePayment = async () => {
        if (!isHost || cartItems.length === 0) return;
        if (Platform.OS !== "web") Haptics.selectionAsync();

        if (paymentMode === 'split') {
            if (splitRequiredMembers.length <= 1) {
                Alert.alert('Split Checkout', 'Split mode works best with multiple members. Add more members or switch payment mode.');
                return;
            }
            if (!splitAllPaid) {
                Alert.alert(
                    'Waiting On Payments',
                    `The order can be submitted after everyone pays.\n\nPending: ${unpaidSplitMembers.join(', ')}`
                );
                return;
            }
            Alert.alert(
                'Submit Group Order',
                `All members paid. Submit ${totalItems} items · $${totalPrice.toFixed(2)} now?`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Submit',
                        style: 'default',
                        onPress: async () => {
                            setSubmitting(true);
                            try {
                                await finaliseSubmit();
                            } catch (e: unknown) {
                                const parsedError = await parseEdgeFunctionError(
                                    e,
                                    'Could not submit the order.'
                                );
                                Alert.alert('Update Failed', parsedError.message);
                            } finally {
                                setSubmitting(false);
                            }
                        },
                    },
                ]
            );
            return;
        }

        if (paymentMode === 'assign' && !isAssignedPayerValid) {
            Alert.alert(
                'Select Eligible Payer',
                'Please choose an app member as payer in Assign mode.'
            );
            return;
        }

        if (paymentMode === 'assign' && assignedPayer && assignedPayer !== guestName) {
            Alert.alert(
                'Assigned Payer',
                `${assignedPayer} is assigned to pay the full bill from their device.`
            );
            return;
        }

        Alert.alert(
            'Submit Group Order',
            `${totalItems} items · $${totalPrice.toFixed(2)}\n\nThis action cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Pay & Submit',
                    style: 'default',
                    onPress: async () => {
                        setSubmitting(true);
                        try {
                            if (!session?.user?.id) {
                                throw new Error('Your session expired. Please sign in again.');
                            }

                            await syncPaymentModeToSession(paymentMode, paymentMode === 'assign' ? assignedPayer : null);

                            const restResponse: any = await withTimeout(
                                (supabase
                                    .from('restaurants')
                                    .select('stripe_account_id')
                                    .eq('id', restaurantId)
                                    .single()) as any,
                                PAYMENT_REQUEST_TIMEOUT_MS,
                                'Request timed out while loading payment settings.'
                            );
                            const { data: restData, error: restError } = restResponse;

                            if (restError) throw restError;

                            const stripeAccountId = restData?.stripe_account_id;

                            if (stripeAccountId) {
                                const cartMeta = buildCartMetaForPayer();
                                const checkoutUrl = await createCheckoutSessionUrl({
                                    restaurant_id: restaurantId,
                                    stripe_account_id: stripeAccountId,
                                    amount: totalPrice,
                                    party_session_id: sessionId,
                                    cart_items: cartMeta,
                                    restaurant_name: restaurantName,
                                    customer_name: guestName,
                                    user_id: session.user.id,
                                    order_type: groupOrderType,
                                });

                                setSubmitting(false);

                                const result = await WebBrowser.openAuthSessionAsync(
                                    checkoutUrl,
                                    'rasvia://'
                                );

                                if (result.type === 'success' && result.url) {
                                    const rawUrl = result.url;
                                    const qIndex = rawUrl.indexOf('?');
                                    const qString = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
                                    const sp = new URLSearchParams(qString);
                                    const params = {
                                        order_id: sp.get('order_id') || '',
                                        restaurant_name: sp.get('restaurant_name') || restaurantName,
                                        order_type: sp.get('order_type') || groupOrderType,
                                        total: sp.get('total') || totalPrice.toFixed(2),
                                        party_session_id: sessionId,
                                    };

                                    if (rawUrl.includes('order-confirmation')) {
                                        setSubmitted(true);
                                        setShowCartModal(false);
                                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                        addEvent({
                                            type: 'group_submitted',
                                            restaurantName,
                                            restaurantId: String(restaurantId),
                                            entryId: String(sessionId),
                                            partySize: cartItems.length,
                                            timestamp: new Date().toISOString(),
                                        });
                                        SecureStore.deleteItemAsync(activeOrderKey);
                                        setTimeout(() => {
                                            router.push({
                                                pathname: '/order-confirmation' as any,
                                                params,
                                            });
                                        }, 150);
                                    } else if (rawUrl.includes('checkout/cancel') || sp.get('checkout_status') === 'cancel') {
                                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                        Alert.alert('Payment Cancelled', 'Your payment was not processed.');
                                    } else if (rawUrl.includes('checkout/error') || sp.get('checkout_status') === 'error') {
                                        const reason = sp.get('reason') || 'unknown';
                                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                                        Alert.alert('Payment Error', `Something went wrong. ${reason}`);
                                    } else {
                                        console.warn('[JoinOrder] Unknown redirect URL:', rawUrl);
                                        Alert.alert('Redirect info', `URL: ${rawUrl}`);
                                    }
                                } else if (!submitted) {
                                    const { data: sessCheck } = await supabase
                                        .from('party_sessions')
                                        .select('status')
                                        .eq('id', sessionId)
                                        .single();

                                    if (sessCheck?.status === 'submitted') {
                                        setSubmitted(true);
                                        setShowCartModal(false);
                                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                        addEvent({
                                            type: 'group_submitted',
                                            restaurantName,
                                            restaurantId: String(restaurantId),
                                            entryId: String(sessionId),
                                            partySize: cartItems.length,
                                            timestamp: new Date().toISOString(),
                                        });
                                        SecureStore.deleteItemAsync(activeOrderKey);
                                    }
                                }
                            } else {
                                await finaliseSubmit();
                            }
                        } catch (e: unknown) {
                            const parsedError = await parseEdgeFunctionError(
                                e,
                                'Could not initiate payment.'
                            );
                            console.error('Group order payment error:', parsedError, e);
                            Alert.alert('Payment Error', parsedError.message);
                        } finally {
                            setSubmitting(false);
                        }
                    },
                },
            ]
        );
    };

    // ─── Loading ─────────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 20 }}>
                    <Pressable onPress={goBack} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                        <ArrowLeft size={20} color="#f5f5f5" />
                    </Pressable>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#FF9933" />
                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 14, marginTop: 12 }}>
                        Loading group order…
                    </Text>
                </View>
            </View>
        );
    }

    // ─── Error State ─────────────────────────────────────────────────────
    if (sessionError) {
        return (
            <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 20 }}>
                    <Pressable onPress={goBack} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                        <ArrowLeft size={20} color="#f5f5f5" />
                    </Pressable>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                    <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 2, borderColor: 'rgba(239,68,68,0.4)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                        <X size={40} color="#EF4444" />
                    </View>
                    <Text style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#f5f5f5', fontSize: 24, textAlign: 'center', marginBottom: 12 }}>
                        Session Not Found
                    </Text>
                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
                        This group order session may have expired or the link is invalid.
                    </Text>
                    <Pressable onPress={goBack} style={{ marginTop: 24, backgroundColor: '#FF9933', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 }}>
                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 16 }}>Go Home</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // ─── Submitted State ─────────────────────────────────────────────────
    if (submitted) {
        return (
            <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 20 }}>
                    <Pressable onPress={goBack} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                        <ArrowLeft size={20} color="#f5f5f5" />
                    </Pressable>
                </View>

                <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                    <View style={{ alignItems: 'center', padding: 32, paddingTop: 40 }}>
                        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 2, borderColor: 'rgba(34,197,94,0.4)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                            <CheckCircle2 size={40} color="#22C55E" />
                        </View>
                        <Text style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#f5f5f5', fontSize: 26, textAlign: 'center', marginBottom: 8 }}>
                            Order Submitted!
                        </Text>
                        <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 4 }}>
                            Your group order at {restaurantName} has been sent to the kitchen.
                        </Text>
                    </View>

                    {/* Order Summary */}
                    <View style={{ paddingHorizontal: 20 }}>
                        {/* Grand Total */}
                        <View style={{ backgroundColor: '#1a1a1a', borderRadius: 20, borderWidth: 1, borderColor: '#2a2a2a', padding: 20, marginBottom: 16 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 18 }}>Grand Total</Text>
                                <Text style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#FF9933', fontSize: 24 }}>${totalPrice.toFixed(2)}</Text>
                            </View>
                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 13, marginTop: 4 }}>
                                {totalItems} items from {uniqueMembers.length} {uniqueMembers.length === 1 ? 'member' : 'members'}
                            </Text>
                        </View>

                        {/* Per-member breakdown */}
                        {Object.entries(memberTotals).map(([name, data]) => {
                            const color = getMemberColor(name, uniqueMembers);
                            return (
                                <Animated.View key={name} entering={FadeInDown.duration(300)}>
                                    <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a2a', padding: 16, marginBottom: 10 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                <MemberAvatar name={name} color={color} size={32} avatarUrl={memberAvatarMap[name]} />
                                                <View>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 15 }}>{name}</Text>
                                                        {name === guestName && isHost && (
                                                            <Crown size={12} color="#FF9933" />
                                                        )}
                                                    </View>
                                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 12 }}>{data.items.length} items</Text>
                                                </View>
                                            </View>
                                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color, fontSize: 16 }}>${data.total.toFixed(2)}</Text>
                                        </View>
                                        {data.items.map(item => {
                                            const qty = item.quantity ?? 1;
                                            return (
                                                <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#262626' }}>
                                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#aaa', fontSize: 13, flex: 1 }} numberOfLines={1}>
                                                        {item.menu_items?.name ?? 'Item'}{qty > 1 ? ` ×${qty}` : ''}
                                                    </Text>
                                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#888', fontSize: 13 }}>${(Number(item.menu_items?.price ?? 0) * qty).toFixed(2)}</Text>
                                                </View>
                                            );
                                        })}
                                    </View>
                                </Animated.View>
                            );
                        })}
                    </View>
                </ScrollView>
            </View>
        );
    }

    // ─── Join Screen ─────────────────────────────────────────────────────
    if (!isJoined) {
        return (
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: '#0f0f0f' }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <Stack.Screen options={{ headerShown: false }} />
                {restaurantImage && (
                    <Image source={{ uri: restaurantImage }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
                )}
                <ScrollView
                    contentContainerStyle={{ flexGrow: 1 }}
                    keyboardShouldPersistTaps="handled"
                >
                <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
                    <Pressable onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 32 }}>
                        <ArrowLeft size={18} color="#999" />
                        <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 14 }}>Back</Text>
                    </Pressable>

                    <Text style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#f5f5f5', fontSize: 28, letterSpacing: -0.5, marginBottom: 6 }}>
                        Join Group Order
                    </Text>
                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 15, marginBottom: 8 }}>
                        {restaurantName}
                    </Text>

                    {uniqueMembers.length > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 }}>
                            <Users size={14} color="#FF9933" />
                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#FF9933', fontSize: 13 }}>
                                {uniqueMembers.length} {uniqueMembers.length === 1 ? 'person' : 'people'} already ordering
                            </Text>
                        </View>
                    )}

                    <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a2a', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16, height: 56 }}>
                        <Users size={18} color="#666" />
                        <TextInput
                            style={{ flex: 1, color: '#f5f5f5', fontFamily: 'Manrope_500Medium', fontSize: 16, marginLeft: 12 }}
                            placeholder="Your name"
                            placeholderTextColor="#555"
                            value={guestName}
                            onChangeText={setGuestName}
                            onSubmitEditing={handleJoin}
                            returnKeyType="go"
                            autoCapitalize="words"
                        />
                    </View>

                    <Pressable onPress={handleJoin} style={{ backgroundColor: '#FF9933', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}>
                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 17 }}>
                            Start Ordering
                        </Text>
                    </Pressable>
                </View>
                </ScrollView>
            </KeyboardAvoidingView>
        );
    }

    // ─── Menu Screen ─────────────────────────────────────────────────────
    return (
        <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Header */}
            <Animated.View entering={FadeIn.duration(400)} style={{
                paddingTop: Platform.OS === 'ios' ? 56 : 40,
                paddingBottom: 12,
                paddingHorizontal: 20,
                backgroundColor: '#0f0f0f',
                borderBottomWidth: 1,
                borderBottomColor: '#1e1e1e',
            }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
                        <Pressable onPress={goBack} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                            <ArrowLeft size={20} color="#f5f5f5" />
                        </Pressable>
                        <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#f5f5f5', fontSize: 20, letterSpacing: -0.3 }}>
                                {restaurantName}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 12 }}>
                                    {guestName}
                                </Text>
                                {isHost && <Crown size={11} color="#FF9933" />}
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#444', fontSize: 12 }}>·</Text>
                                <Users size={11} color="#666" />
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 12 }}>
                                    {uniqueMembers.length || 1}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {isHost && (
                        <Pressable
                            onPress={cancelGroupOrder}
                            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                        >
                            <Trash2 size={18} color="#EF4444" />
                        </Pressable>
                    )}
                    <Pressable
                        onPress={async () => {
                            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            const url = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${sessionId}`;
                            try {
                                await Share.share({
                                    message: `Join my group order at ${restaurantName}! 🍽️\n${url}`,
                                    url,
                                });
                            } catch { }
                        }}
                        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                    >
                        <Share2 size={18} color="#f5f5f5" />
                    </Pressable>
                    <Pressable
                        onPress={() => totalItems > 0 && setShowCartModal(true)}
                        style={{ position: 'relative', width: 44, height: 44, borderRadius: 22, backgroundColor: totalItems > 0 ? '#FF9933' : '#1a1a1a', borderWidth: 1, borderColor: totalItems > 0 ? '#FF9933' : '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ShoppingCart size={20} color={totalItems > 0 ? '#0f0f0f' : '#666'} />
                        {totalItems > 0 && (
                            <View style={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#FF9933', fontSize: 10 }}>{totalItems}</Text>
                            </View>
                        )}
                    </Pressable>
                </View>

                {/* Search Bar */}
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', borderRadius: 12, borderWidth: 1, borderColor: '#1e1e1e', paddingHorizontal: 12, marginTop: 12, gap: 8 }}>
                    <Search size={16} color="#555" />
                    <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search menu…"
                        placeholderTextColor="#444"
                        style={{ flex: 1, fontFamily: 'Manrope_500Medium', color: '#f5f5f5', fontSize: 14, paddingVertical: 10 }}
                    />
                    {searchQuery.length > 0 && (
                        <Pressable onPress={() => setSearchQuery('')}>
                            <X size={14} color="#666" />
                        </Pressable>
                    )}
                </View>

                {/* Category Filter */}
                {menuCategories.length > 2 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
                        {menuCategories.map(cat => {
                            const isActive = selectedCategory === cat;
                            const cfg = cat !== 'all' ? MEAL_PERIOD_CFG[cat as MealPeriod] : null;
                            return (
                                <Pressable
                                    key={cat}
                                    onPress={() => setSelectedCategory(cat)}
                                    style={{
                                        backgroundColor: isActive ? 'rgba(255,153,51,0.2)' : '#141414',
                                        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
                                        borderWidth: 1, borderColor: isActive ? '#FF9933' : '#2a2a2a',
                                    }}
                                >
                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: isActive ? '#FF9933' : '#999', fontSize: 12 }}>
                                        {cat === 'all' ? 'All' : cfg?.label ?? cat}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}
            </Animated.View>

            {/* Live Members Strip */}
            {uniqueMembers.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#0f0f0f', borderBottomWidth: 1, borderBottomColor: '#1e1e1e', gap: 8 }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#666', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>Live</Text>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' }} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {uniqueMembers.map(name => {
                            const color = getMemberColor(name, uniqueMembers);
                            const memberData = memberTotals[name];
                            return (
                                <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#2a2a2a' }}>
                                    <MemberAvatar name={name} color={color} size={20} avatarUrl={memberAvatarMap[name]} />
                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#ccc', fontSize: 12 }}>{name}</Text>
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 11 }}>${memberData?.total.toFixed(2) ?? '0.00'}</Text>
                                </View>
                            );
                        })}
                    </ScrollView>
                </View>
            )}

            {/* Menu List */}
            <FlatList
                data={filteredMenu}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
                ListEmptyComponent={
                    <View style={{ alignItems: 'center', paddingTop: 60 }}>
                        <Text style={{ fontFamily: 'Manrope_500Medium', color: '#555', fontSize: 14 }}>
                            {searchQuery ? `No items match "${searchQuery}"` : 'No menu items available'}
                        </Text>
                    </View>
                }
                renderItem={({ item, index }) => {
                    const isExpanded = expandedItemId === item.id.toString();
                    const mealPeriod = item.meal_period as MealPeriod | undefined;
                    const itemInCart = cartItems.filter(ci => ci.menu_item_id === item.id || ci.menu_items?.name === item.name);
                    const itemInCartQty = itemInCart.reduce((sum, ci) => sum + (ci.quantity ?? 1), 0);

                    return (
                        <Animated.View entering={FadeInDown.delay(Math.min(index * 40, 400)).duration(400)}>
                            <Pressable
                                onPress={() => {
                                    if (Platform.OS !== 'web') Haptics.selectionAsync();
                                    setExpandedItemId(isExpanded ? null : item.id.toString());
                                }}
                                style={{
                                    backgroundColor: '#1a1a1a',
                                    borderRadius: 20,
                                    borderWidth: 1,
                                    borderColor: isExpanded ? '#FF9933' : itemInCartQty > 0 ? 'rgba(255,153,51,0.3)' : '#2a2a2a',
                                    marginBottom: 12,
                                    overflow: 'hidden',
                                }}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 }}>
                                    {item.image_url ? (
                                        <Image source={{ uri: item.image_url }} style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: '#262626' }} resizeMode="cover" />
                                    ) : (
                                        <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={{ fontSize: 28 }}>🍽️</Text>
                                        </View>
                                    )}

                                    <View style={{ flex: 1 }}>
                                        <Text numberOfLines={1} style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 16, marginBottom: 4 }}>
                                            {item.name}
                                        </Text>
                                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                                            {mealPeriod && <MealPeriodTag period={mealPeriod} />}
                                            {item.is_vegetarian && (
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', paddingHorizontal: 8, paddingVertical: 3 }}>
                                                    <Leaf size={10} color="#22C55E" />
                                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#22C55E', fontSize: 10 }}>Veg</Text>
                                                </View>
                                            )}
                                            {item.is_spicy && (
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', paddingHorizontal: 8, paddingVertical: 3 }}>
                                                    <Flame size={10} color="#EF4444" />
                                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#EF4444', fontSize: 10 }}>Spicy</Text>
                                                </View>
                                            )}
                                            {itemInCartQty > 0 && (
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,153,51,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,153,51,0.3)', paddingHorizontal: 8, paddingVertical: 3 }}>
                                                    <ShoppingCart size={10} color="#FF9933" />
                                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#FF9933', fontSize: 10 }}>×{itemInCartQty}</Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#FF9933', fontSize: 15 }}>
                                            ${Number(item.price).toFixed(2)}
                                        </Text>
                                    </View>

                                    {isExpanded ? <ChevronUp size={18} color="#FF9933" /> : <ChevronDown size={18} color="#555" />}
                                </View>

                                {isExpanded && (
                                    <Animated.View entering={FadeInDown.duration(250)} style={{ borderTopWidth: 1, borderTopColor: '#2a2a2a', padding: 16 }}>
                                        {item.description ? (
                                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#aaa', fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
                                                {item.description}
                                            </Text>
                                        ) : null}

                                        {/* Quantity Stepper */}
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 14 }}>
                                            <Pressable
                                                onPress={() => {
                                                    const key = item.id.toString();
                                                    setItemQuantities(prev => ({
                                                        ...prev,
                                                        [key]: Math.max(1, (prev[key] ?? 1) - 1),
                                                    }));
                                                }}
                                                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626', borderWidth: 1, borderColor: '#3a3a3a', alignItems: 'center', justifyContent: 'center' }}
                                            >
                                                <Minus size={18} color="#f5f5f5" />
                                            </Pressable>
                                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 20, minWidth: 32, textAlign: 'center' }}>
                                                {itemQuantities[item.id.toString()] ?? 1}
                                            </Text>
                                            <Pressable
                                                onPress={() => {
                                                    const key = item.id.toString();
                                                    setItemQuantities(prev => ({
                                                        ...prev,
                                                        [key]: (prev[key] ?? 1) + 1,
                                                    }));
                                                }}
                                                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626', borderWidth: 1, borderColor: '#3a3a3a', alignItems: 'center', justifyContent: 'center' }}
                                            >
                                                <Plus size={18} color="#f5f5f5" />
                                            </Pressable>
                                        </View>

                                        <Pressable
                                            onPress={() => { const qty = itemQuantities[item.id.toString()] ?? 1; addToCart(item, qty); setExpandedItemId(null); }}
                                            style={{ backgroundColor: '#FF9933', borderRadius: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                        >
                                            <Plus size={18} color="#0f0f0f" />
                                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 15 }}>
                                                Add {itemQuantities[item.id.toString()] ?? 1} to Order · ${(Number(item.price) * (itemQuantities[item.id.toString()] ?? 1)).toFixed(2)}
                                            </Text>
                                        </Pressable>
                                    </Animated.View>
                                )}
                            </Pressable>
                        </Animated.View>
                    );
                }}
            />

            {/* Floating Cart Bar */}
            {totalItems > 0 && (
                <Animated.View entering={FadeInUp.duration(300)} style={{ position: 'absolute', bottom: 32, left: 16, right: 16 }}>
                    <Pressable
                        onPress={() => setShowCartModal(true)}
                        style={{ backgroundColor: '#FF9933', borderRadius: 20, paddingVertical: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#FF9933', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 12 }}
                    >
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 14 }}>{totalItems}</Text>
                        </View>
                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 16 }}>View Group Order</Text>
                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 15 }}>${totalPrice.toFixed(2)}</Text>
                    </Pressable>
                </Animated.View>
            )}

            {/* Cart Modal */}
            <Modal
                visible={showCartModal}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={closeCartModal}
                onDismiss={() => {
                    setSplitEditItem(null);
                    setSplitSelectedMembers([]);
                }}
            >
                <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>
                    {/* Modal Header */}
                    <View style={{ paddingTop: 20, paddingBottom: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#1e1e1e' }}>
                        <View>
                            <Text style={{ fontFamily: 'BricolageGrotesque_800ExtraBold', color: '#f5f5f5', fontSize: 22 }}>Group Order</Text>
                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 13, marginTop: 2 }}>
                                {totalItems} items · {uniqueMembers.length} {uniqueMembers.length === 1 ? 'member' : 'members'}
                            </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            {isHost && groupOrderType === 'dine_in' && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a', paddingHorizontal: 8, paddingVertical: 6 }}>
                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 11, marginRight: 6 }}>Party</Text>
                                    <Pressable
                                        onPress={() => { if (groupPartySize > 1) { setGroupPartySize(p => p - 1); if (Platform.OS !== 'web') Haptics.selectionAsync(); } }}
                                        style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' }}
                                    >
                                        <Minus size={12} color="#f5f5f5" />
                                    </Pressable>
                                    <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 14, minWidth: 18, textAlign: 'center', marginHorizontal: 6 }}>
                                        {groupPartySize}
                                    </Text>
                                    <Pressable
                                        onPress={() => { setGroupPartySize(p => p + 1); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                                        style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' }}
                                    >
                                        <Plus size={12} color="#f5f5f5" />
                                    </Pressable>
                                </View>
                            )}
                            <Pressable onPress={closeCartModal} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} color="#f5f5f5" />
                            </Pressable>
                        </View>
                    </View>

                    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                                        setGroupOrderType((prev) => (prev === 'dine_in' ? 'takeout' : 'dine_in'));
                                    }}
                                    style={{
                                        height: 58,
                                        borderRadius: 12,
                                        borderWidth: 1.5,
                                        borderColor: groupOrderType === 'dine_in' ? '#FF9933' : '#14B8A6',
                                        backgroundColor: groupOrderType === 'dine_in' ? 'rgba(255,153,51,0.12)' : 'rgba(20,184,166,0.12)',
                                        paddingHorizontal: 12,
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                    }}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                                        {groupOrderType === 'dine_in' ? (
                                            <UtensilsCrossed size={16} color="#FF9933" />
                                        ) : (
                                            <Truck size={16} color="#14B8A6" />
                                        )}
                                        <Text style={{ fontFamily: 'Manrope_700Bold', color: groupOrderType === 'dine_in' ? '#FF9933' : '#14B8A6', fontSize: 14 }}>
                                            {groupOrderType === 'dine_in' ? 'Dine In' : 'Takeout'}
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#9ca3af', fontSize: 9, marginTop: 5 }}>
                                        {groupOrderType === 'dine_in' ? 'Tap for takeout' : 'Tap for dine in'}
                                    </Text>
                                </Pressable>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                                        setShowMemberBreakdown((prev) => !prev);
                                    }}
                                    style={{
                                        height: 58,
                                        borderRadius: 10,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: '#1a1a1a',
                                        borderWidth: 1,
                                        borderColor: '#2a2a2a'
                                    }}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                        {showMemberBreakdown ? (
                                            <Users size={14} color={showMemberBreakdown ? '#FF9933' : '#999'} />
                                        ) : (
                                            <ShoppingCart size={14} color={showMemberBreakdown ? '#FF9933' : '#999'} />
                                        )}
                                        <Text style={{ fontFamily: 'Manrope_700Bold', color: showMemberBreakdown ? '#FF9933' : '#999', fontSize: 12 }}>
                                            {showMemberBreakdown ? 'By Member' : 'All Items'}
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#9ca3af', fontSize: 8, marginTop: 4 }}>
                                        {showMemberBreakdown ? 'Tap for all items' : 'Tap for by member'}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>

                    <View style={{ flex: 1 }}>
                    {cartItems.length === 0 ? (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <ShoppingCart size={48} color="#333" />
                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#555', fontSize: 15, marginTop: 12 }}>No items yet</Text>
                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#444', fontSize: 13, marginTop: 4 }}>Add items from the menu to get started</Text>
                        </View>
                    ) : showMemberBreakdown ? (
                        /* By Member View */
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
                            {Object.entries(memberTotals).map(([name, data]) => {
                                const color = getMemberColor(name, uniqueMembers);
                                return (
                                    <View key={name} style={{ marginBottom: 16 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                <MemberAvatar name={name} color={color} size={28} avatarUrl={memberAvatarMap[name]} />
                                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 15 }}>{name}</Text>
                                                {name === guestName && isHost && <Crown size={12} color="#FF9933" />}
                                                {paymentMode === 'split' && splitPaidMemberSet.has(normalizeMemberName(name)) && (
                                                    <View style={{ backgroundColor: 'rgba(34,197,94,0.2)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                        <Text style={{ fontFamily: 'Manrope_700Bold', color: '#22C55E', fontSize: 10 }}>Paid</Text>
                                                    </View>
                                                )}
                                            </View>
                                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color, fontSize: 15 }}>${data.total.toFixed(2)}</Text>
                                        </View>
                                        {data.items.map((item: any) => (
                                            <View key={`${item.id}-${name}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a2a', padding: 12, marginBottom: 6 }}>
                                                <View style={{ flex: 1 }}>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 14 }} numberOfLines={1}>
                                                            {item.menu_items?.name ?? 'Item'}
                                                        </Text>
                                                        {(item.quantity ?? 1) > 1 && !item.__splitMembers?.length && (
                                                            <View style={{ backgroundColor: 'rgba(255,153,51,0.15)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#FF9933', fontSize: 11 }}>×{item.quantity}</Text>
                                                            </View>
                                                        )}
                                                        {item.__splitMembers?.length >= 2 && (
                                                            <View style={{ backgroundColor: 'rgba(129,140,248,0.15)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#818CF8', fontSize: 10 }}>
                                                                    Split {item.__splitMembers.length} ways
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#FF9933', fontSize: 13, marginTop: 2 }}>
                                                        ${((Number(item.__allocatedCents ?? 0)) / 100).toFixed(2)}
                                                    </Text>
                                                </View>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 }}>
                                                    {isHost && paymentMode === 'split' && uniqueMembers.length > 1 && (
                                                        <Pressable
                                                            onPress={() => openSplitEditor(item)}
                                                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(99,102,241,0.4)', backgroundColor: 'rgba(99,102,241,0.12)', paddingHorizontal: 8, paddingVertical: 6 }}
                                                        >
                                                            <SlidersHorizontal size={12} color="#818CF8" />
                                                            <Text style={{ fontFamily: 'Manrope_700Bold', color: '#818CF8', fontSize: 10 }}>Modify</Text>
                                                        </Pressable>
                                                    )}
                                                    {(isHost || item.added_by_name === guestName) && !submitted && (
                                                        <Pressable
                                                            onPress={() => {
                                                                Alert.alert(
                                                                    'Remove Item',
                                                                    `Remove "${item.menu_items?.name ?? 'this item'}" from the order?`,
                                                                    [
                                                                        { text: 'Cancel', style: 'cancel' },
                                                                        { text: 'Remove', style: 'destructive', onPress: () => removeFromCart(item.id) },
                                                                    ]
                                                                );
                                                            }}
                                                            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', alignItems: 'center', justifyContent: 'center' }}
                                                        >
                                                            <Trash2 size={14} color="#EF4444" />
                                                        </Pressable>
                                                    )}
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    ) : (
                        /* All Items View */
                        <FlatList
                            style={{ flex: 1 }}
                            data={combinedAllItems}
                            keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
                            contentContainerStyle={{ padding: 16, paddingBottom: 180 }}
                            renderItem={({ item }) => {
                                const contributors = Array.from(item.contributors);
                                return (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a2a', padding: 14, marginBottom: 10 }}>
                                        <View style={{ flex: 1, marginLeft: 11 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 15 }} numberOfLines={1}>
                                                    {item.name}
                                                </Text>
                                                {item.quantity > 1 && (
                                                    <View style={{ backgroundColor: 'rgba(255,153,51,0.15)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#FF9933', fontSize: 11 }}>×{item.quantity}</Text>
                                                    </View>
                                                )}
                                            </View>
                                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 12, marginTop: 2 }}>
                                                {contributors.length === 0 ? "Group item" : `By ${contributors.join(", ")}`}
                                            </Text>
                                        </View>
                                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#FF9933', fontSize: 15 }}>
                                            ${item.total.toFixed(2)}
                                        </Text>
                                    </View>
                                );
                            }}
                        />
                    )}
                    </View>

                    {/* Footer */}
                    <View style={{ padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 20, borderTopWidth: 1, borderTopColor: '#1e1e1e', backgroundColor: '#0f0f0f' }}>
                        {/* Total */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 14 }}>Group Total</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 20 }}>${totalPrice.toFixed(2)}</Text>
                                {paymentMode === 'split' && !splitAllPaid && unpaidSplitMembers.length > 0 && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(165,180,252,0.45)', backgroundColor: 'rgba(165,180,252,0.12)', paddingHorizontal: 7, paddingVertical: 3 }}>
                                        <Clock size={11} color="#A5B4FC" />
                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#A5B4FC', fontSize: 10 }}>
                                            {unpaidSplitMembers.length} pending
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>

                        {isHost && cartItems.length > 0 && (
                            <View style={{ marginBottom: 10 }}>
                                {/* Assign payer selector */}
                                {paymentMode === 'assign' && (
                                    <View style={{ backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)', padding: 12, marginBottom: 8 }}>
                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#F97316', fontSize: 12, marginBottom: 8 }}>Who pays the full bill?</Text>
                                        {assignableMembers.map(name => {
                                            const color = getMemberColor(name, uniqueMembers);
                                            const isSelected = assignedPayer === name;
                                            return (
                                                <Pressable
                                                    key={name}
                                                    onPress={() => {
                                                        if (paymentModeSyncing) return;
                                                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                                                        syncPaymentModeToSession('assign', name).catch((e) => {
                                                            parseEdgeFunctionError(e, 'Could not update assigned payer.').then((err) => Alert.alert('Update Failed', err.message));
                                                        });
                                                    }}
                                                    disabled={paymentModeSyncing}
                                                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, backgroundColor: isSelected ? 'rgba(249,115,22,0.15)' : 'transparent', marginBottom: 4 }}
                                                >
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                        <MemberAvatar name={name} color={color} size={24} avatarUrl={memberAvatarMap[name]} />
                                                        <Text style={{ fontFamily: isSelected ? 'Manrope_700Bold' : 'Manrope_500Medium', color: isSelected ? '#F97316' : '#ccc', fontSize: 14 }}>{name}</Text>
                                                        {name === guestName && isHost && <Crown size={11} color="#FF9933" />}
                                                    </View>
                                                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: isSelected ? '#F97316' : '#444', backgroundColor: isSelected ? '#F97316' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                                                        {isSelected && <CheckCircle2 size={14} color="#fff" />}
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                        {assignableMembers.length < uniqueMembers.length && (
                                            <Text style={{ fontFamily: 'Manrope_500Medium', color: '#f59e0b', fontSize: 11, marginTop: 6 }}>
                                                Web-only participants cannot be assigned as payer yet.
                                            </Text>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}

                        {paymentMode === 'split' && uniqueMembers.length > 1 && (
                            <View style={{ marginBottom: 10 }}>
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                                        setShowMemberSplitOverlay(true);
                                    }}
                                    style={{ borderRadius: 12, borderWidth: 1, borderColor: 'rgba(129,140,248,0.4)', backgroundColor: 'rgba(129,140,248,0.12)', paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                                >
                                    <Users size={14} color="#A5B4FC" />
                                    <Text style={{ fontFamily: 'Manrope_700Bold', color: '#A5B4FC', fontSize: 12 }}>
                                        Show Member Split
                                    </Text>
                                </Pressable>
                            </View>
                        )}

                        <View style={{ gap: 10 }}>
                            {isHost && cartItems.length > 0 && (
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                    <Pressable
                                        onPress={() => {
                                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                                            syncPaymentModeToSession('host_pays', null).catch((e) => {
                                                parseEdgeFunctionError(e, 'Could not update payment mode.').then((err) => Alert.alert('Update Failed', err.message));
                                            });
                                        }}
                                        disabled={paymentModeSyncing}
                                        style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 7, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', backgroundColor: paymentMode === 'host_pays' ? 'rgba(34,197,94,0.12)' : '#1a1a1a', borderColor: paymentMode === 'host_pays' ? '#22C55E' : '#2a2a2a', opacity: paymentModeSyncing ? 0.55 : 1 }}
                                    >
                                        <Wallet size={14} color={paymentMode === 'host_pays' ? '#22C55E' : '#666'} style={{ marginBottom: 3 }} />
                                        <Text style={{ fontFamily: paymentMode === 'host_pays' ? 'Manrope_700Bold' : 'Manrope_500Medium', color: paymentMode === 'host_pays' ? '#22C55E' : '#777', fontSize: 12, textAlign: 'center' }}>I&apos;ll Pay</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => {
                                            if (!canUseMultiPayerModes) return;
                                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                                            syncPaymentModeToSession('split', null).catch((e) => {
                                                parseEdgeFunctionError(e, 'Could not update payment mode.').then((err) => Alert.alert('Update Failed', err.message));
                                            });
                                        }}
                                        disabled={paymentModeSyncing || !canUseMultiPayerModes}
                                        style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 7, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', backgroundColor: paymentMode === 'split' ? 'rgba(129,140,248,0.12)' : '#1a1a1a', borderColor: paymentMode === 'split' ? '#818CF8' : '#2a2a2a', opacity: (!canUseMultiPayerModes || paymentModeSyncing) ? 0.45 : 1 }}
                                    >
                                        <Users size={14} color={paymentMode === 'split' ? '#818CF8' : '#666'} style={{ marginBottom: 3 }} />
                                        <Text style={{ fontFamily: paymentMode === 'split' ? 'Manrope_700Bold' : 'Manrope_500Medium', color: paymentMode === 'split' ? '#818CF8' : '#777', fontSize: 12, textAlign: 'center' }}>Split by Person</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => {
                                            if (!canUseMultiPayerModes) return;
                                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                                            const fallbackPayer = assignedPayer || guestName || assignableMembers[0] || null;
                                            syncPaymentModeToSession('assign', fallbackPayer).catch((e) => {
                                                parseEdgeFunctionError(e, 'Could not update payment mode.').then((err) => Alert.alert('Update Failed', err.message));
                                            });
                                        }}
                                        disabled={paymentModeSyncing || !canUseMultiPayerModes}
                                        style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 7, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', backgroundColor: paymentMode === 'assign' ? 'rgba(249,115,22,0.12)' : '#1a1a1a', borderColor: paymentMode === 'assign' ? '#F97316' : '#2a2a2a', opacity: (!canUseMultiPayerModes || paymentModeSyncing) ? 0.45 : 1 }}
                                    >
                                        <Crown size={14} color={paymentMode === 'assign' ? '#F97316' : '#666'} style={{ marginBottom: 3 }} />
                                        <Text style={{ fontFamily: paymentMode === 'assign' ? 'Manrope_700Bold' : 'Manrope_500Medium', color: paymentMode === 'assign' ? '#F97316' : '#777', fontSize: 12, textAlign: 'center' }}>Assign</Text>
                                    </Pressable>
                                </View>
                            )}

                            {isHost && paymentMode !== 'split' ? (
                                <Pressable
                                    onPress={handlePayment}
                                    disabled={
                                        submitting ||
                                        cartItems.length === 0 ||
                                        !isAssignedPayerValid
                                    }
                                    style={{
                                        backgroundColor:
                                            (cartItems.length === 0 || !isAssignedPayerValid)
                                                ? '#333'
                                                : '#22C55E',
                                        borderRadius: 16,
                                        paddingVertical: 16,
                                        alignItems: 'center',
                                        flexDirection: 'row',
                                        justifyContent: 'center',
                                        gap: 8,
                                        opacity: submitting ? 0.6 : 1,
                                    }}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <>
                                            <CreditCard size={18} color="#fff" />
                                            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#fff', fontSize: 17 }}>
                                                {paymentMode === 'assign' && assignedPayer
                                                    ? `${assignedPayer} Pays · $${totalPrice.toFixed(2)}`
                                                    : `Pay & Submit · $${totalPrice.toFixed(2)}`}
                                            </Text>
                                        </>
                                    )}
                                </Pressable>
                            ) : !isHost ? (
                                <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a2a', paddingVertical: 16, alignItems: 'center' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <Crown size={16} color="#FF9933" />
                                        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#FF9933', fontSize: 16 }}>
                                            Waiting for host to submit
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#666', fontSize: 12 }}>
                                        Keep adding items while you wait
                                    </Text>
                                </View>
                            ) : null
                            }

                            {paymentMode === 'split' ? (
                                myShareTotal > 0 ? (
                                    <Pressable
                                        onPress={handlePayMyShare}
                                        disabled={payingMyShare || mySharePaid}
                                        style={{ backgroundColor: '#6366F1', borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: (payingMyShare || mySharePaid) ? 0.6 : 1 }}
                                    >
                                        {payingMyShare ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : (
                                            <>
                                                {mySharePaid ? <CheckCircle2 size={18} color="#fff" /> : <CreditCard size={18} color="#fff" />}
                                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#fff', fontSize: 17 }}>
                                                    {mySharePaid ? 'My Share Paid' : `Pay My Share · $${myShareTotal.toFixed(2)}`}
                                                </Text>
                                            </>
                                        )}
                                    </Pressable>
                                ) : (
                                    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.12)', paddingVertical: 16, alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#A5B4FC', fontSize: 13 }}>
                                            {isHost ? `Waiting on ${unpaidSplitMembers.length} payment${unpaidSplitMembers.length === 1 ? '' : 's'}` : 'No split amount yet'}
                                        </Text>
                                    </View>
                                )
                            ) : null}
                        </View>
                    </View>

                    {showCartModal && showMemberSplitOverlay && (
                        <View
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0,0,0,0.72)',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 20,
                            }}
                        >
                            <View style={{ width: '100%', maxWidth: 420, maxHeight: '78%', backgroundColor: '#141414', borderRadius: 18, borderWidth: 1, borderColor: '#2a2a2a', padding: 16 }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 18 }}>
                                    Member Split
                                </Text>
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 13, marginTop: 4 }}>
                                    Detailed split by member
                                </Text>

                                <ScrollView style={{ marginTop: 12, maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                                    <View style={{ gap: 8 }}>
                                        {uniqueMembers.map((name) => {
                                            const color = getMemberColor(name, uniqueMembers);
                                            const memberShare = memberTotals[name]?.total ?? 0;
                                            const hasPaid = splitPaidMemberSet.has(normalizeMemberName(name));
                                            return (
                                                <View
                                                    key={`member-split-${name}`}
                                                    style={{
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        backgroundColor: '#1a1a1a',
                                                        borderRadius: 12,
                                                        borderWidth: 1,
                                                        borderColor: '#2a2a2a',
                                                        paddingHorizontal: 10,
                                                        paddingVertical: 10,
                                                    }}
                                                >
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                        <MemberAvatar name={name} color={color} size={22} avatarUrl={memberAvatarMap[name]} />
                                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#ddd', fontSize: 13 }}>{name}</Text>
                                                        {hasPaid && (
                                                            <Text style={{ fontFamily: 'Manrope_700Bold', color: '#22C55E', fontSize: 10 }}>Paid</Text>
                                                        )}
                                                    </View>
                                                    <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#A5B4FC', fontSize: 14 }}>
                                                        ${memberShare.toFixed(2)}
                                                    </Text>
                                                </View>
                                            );
                                        })}
                                    </View>
                                </ScrollView>

                                {!splitAllPaid && unpaidSplitMembers.length > 0 && (
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#a5b4fc', fontSize: 12, marginTop: 10 }}>
                                        Pending payment: {unpaidSplitMembers.join(', ')}
                                    </Text>
                                )}

                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                                        setShowMemberSplitOverlay(false);
                                    }}
                                    style={{ marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: '#333', backgroundColor: '#1f1f1f', paddingVertical: 11, alignItems: 'center' }}
                                >
                                    <Text style={{ fontFamily: 'Manrope_700Bold', color: '#ddd', fontSize: 13 }}>Close</Text>
                                </Pressable>
                            </View>
                        </View>
                    )}

                    {showCartModal && !!splitEditItem && (
                        <View
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0,0,0,0.72)',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 20,
                            }}
                        >
                            <View style={{ width: '100%', maxHeight: '86%', backgroundColor: '#141414', borderRadius: 18, borderWidth: 1, borderColor: '#2a2a2a', padding: 16 }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#f5f5f5', fontSize: 18 }}>
                                    Modify Split
                                </Text>
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#999', fontSize: 13, marginTop: 4 }}>
                                    {splitEditItem?.menu_items?.name ?? 'Item'} · Qty {splitEditItem?.quantity ?? 1}
                                </Text>
                                <Text style={{ fontFamily: 'Manrope_500Medium', color: '#818CF8', fontSize: 12, marginTop: 8 }}>
                                    Select members to split equally.
                                </Text>

                                <ScrollView style={{ marginTop: 12, maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                                    <View style={{ gap: 8, paddingBottom: 2 }}>
                                        {uniqueMembers.map((name) => {
                                            const color = getMemberColor(name, uniqueMembers);
                                            const isSelected = splitSelectedMembers.includes(name);
                                            return (
                                                <Pressable
                                                    key={`split-edit-${name}`}
                                                    onPress={() => {
                                                        setSplitSelectedMembers((prev) => {
                                                            if (prev.includes(name)) return prev.filter((n) => n !== name);
                                                            return [...prev, name];
                                                        });
                                                    }}
                                                    style={{
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        backgroundColor: isSelected ? 'rgba(99,102,241,0.15)' : '#1a1a1a',
                                                        borderRadius: 12,
                                                        borderWidth: 1,
                                                        borderColor: isSelected ? 'rgba(99,102,241,0.45)' : '#2a2a2a',
                                                        paddingHorizontal: 10,
                                                        paddingVertical: 10,
                                                    }}
                                                >
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                        <MemberAvatar name={name} color={color} size={22} avatarUrl={memberAvatarMap[name]} />
                                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#ddd', fontSize: 13 }}>{name}</Text>
                                                    </View>
                                                    <View
                                                        style={{
                                                            width: 20,
                                                            height: 20,
                                                            borderRadius: 10,
                                                            borderWidth: 2,
                                                            borderColor: isSelected ? '#818CF8' : '#444',
                                                            backgroundColor: isSelected ? '#818CF8' : 'transparent',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }}
                                                    >
                                                        {isSelected ? <CheckCircle2 size={12} color="#fff" /> : null}
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </ScrollView>

                                {splitSelectedMembers.length >= 1 && (
                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: '#a5b4fc', fontSize: 12, marginTop: 10 }}>
                                        Each selected member pays ${((Number(splitEditItem?.menu_items?.price ?? 0) * Math.max(1, Number(splitEditItem?.quantity ?? 1))) / splitSelectedMembers.length).toFixed(2)}.
                                    </Text>
                                )}

                                <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                                    <Pressable
                                        onPress={() => {
                                            setSplitEditItem(null);
                                            setSplitSelectedMembers([]);
                                        }}
                                        style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#333', backgroundColor: '#1f1f1f', paddingVertical: 11, alignItems: 'center' }}
                                    >
                                        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#aaa', fontSize: 13 }}>Cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={saveSplitEditor}
                                        disabled={savingSplitDraft}
                                        style={{ flex: 1, borderRadius: 12, backgroundColor: '#6366F1', paddingVertical: 11, alignItems: 'center', opacity: savingSplitDraft ? 0.6 : 1 }}
                                    >
                                        {savingSplitDraft ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : (
                                            <Text style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 13 }}>Save Split</Text>
                                        )}
                                    </Pressable>
                                </View>
                            </View>
                        </View>
                    )}
                </View>
            </Modal>
        </View>
    );
}
