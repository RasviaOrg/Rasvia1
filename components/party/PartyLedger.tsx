// components/party/PartyLedger.tsx
// Stunning live view of who has paid and who hasn't. Animated status dots.
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { Check, Clock, Crown, AlertCircle, RefreshCcw } from 'lucide-react-native';
import {
  type PartyMember,
  type PartyPayment,
  formatCents,
} from '../../lib/party-session';
import { useAppTheme } from '../../lib/app-theme';

const MEMBER_COLORS = ['#FF9933', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'];

export function colorForMember(memberId: string, members: PartyMember[]): string {
  const idx = members.findIndex((m) => m.id === memberId);
  return MEMBER_COLORS[((idx < 0 ? 0 : idx) % MEMBER_COLORS.length)];
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

type LedgerRowProps = {
  member: PartyMember;
  payment: PartyPayment | undefined;
  index: number;
  isSelf: boolean;
  isHost: boolean;
  showCoverButton: boolean;
  onCover?: () => void;
  onRetry?: () => void;
  onPress?: () => void;
};

function usePartyLedgerStyles() {
  const { colors } = useAppTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.card,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        },
        headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
        headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
        headerSub: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
        progressText: { fontSize: 13, fontWeight: '700' },
        progressMeta: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
        progressBar: { height: 6, backgroundColor: colors.pressableBg, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
        progressFill: { height: '100%', backgroundColor: '#22C55E', borderRadius: 3 },
        row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
        avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', position: 'relative' },
        avatarText: { color: '#0f0f0f', fontWeight: '800', fontSize: 13 },
        crown: {
          position: 'absolute',
          top: -4,
          right: -4,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: '#F59E0B',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: colors.card,
        },
        name: { color: colors.text, fontWeight: '700', fontSize: 14, maxWidth: 160 },
        youPill: {
          color: '#FF9933',
          fontSize: 10,
          fontWeight: '800',
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 6,
          backgroundColor: 'rgba(255,153,51,0.12)',
        },
        statusDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
        statusLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
        amount: { color: colors.text, fontWeight: '700', fontSize: 14 },
        coverBtn: {
          backgroundColor: 'rgba(255,153,51,0.16)',
          borderWidth: 1,
          borderColor: 'rgba(255,153,51,0.4)',
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
        },
        coverBtnText: { color: '#FF9933', fontWeight: '700', fontSize: 11 },
        retryBtn: {
          backgroundColor: 'rgba(239,68,68,0.15)',
          borderWidth: 1,
          borderColor: 'rgba(239,68,68,0.4)',
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
        },
        retryBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 11 },
      }),
    [colors],
  );
}

function StatusDot({ status }: { status: PartyPayment['status'] | 'idle' }) {
  const styles = usePartyLedgerStyles();
  const map: Record<string, { color: string; Icon: typeof Check; label: string }> = {
    idle: { color: '#52525B', Icon: Clock, label: 'Not ready' },
    pending: { color: '#F59E0B', Icon: Clock, label: 'Awaiting payment' },
    paid: { color: '#22C55E', Icon: Check, label: 'Paid' },
    covered: { color: '#10B981', Icon: Check, label: 'Covered' },
    refunded: { color: '#A1A1AA', Icon: RefreshCcw, label: 'Refunded' },
    failed: { color: '#EF4444', Icon: AlertCircle, label: 'Failed' },
    cancelled: { color: '#6B7280', Icon: AlertCircle, label: 'Cancelled' },
  };
  const cfg = map[status] || map.idle;
  const { Icon } = cfg;
  return (
    <View style={[styles.statusDot, { backgroundColor: cfg.color }]}>
      <Icon size={12} color="#ffffff" strokeWidth={3} />
    </View>
  );
}

function LedgerRow({ member, payment, index, isSelf, isHost, showCoverButton, onCover, onRetry, onPress }: LedgerRowProps) {
  const styles = usePartyLedgerStyles();
  const { colors } = useAppTheme();
  const status = payment?.status ?? 'idle';
  const amount = payment?.amount_cents ?? 0;
  const color = MEMBER_COLORS[index % MEMBER_COLORS.length];
  const isPaid = status === 'paid' || status === 'covered';
  const isFailed = status === 'failed' || status === 'cancelled';

  return (
    <Animated.View entering={FadeInDown.delay(index * 60)} layout={Layout.springify()}>
      <Pressable onPress={onPress} style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: member.avatar_url ? colors.pressableBg : color, overflow: 'hidden' }]}>
          {member.avatar_url ? (
            <Image source={{ uri: member.avatar_url }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Text style={styles.avatarText}>{memberInitials(member.display_name)}</Text>
          )}
          {member.role === 'host' ? (
            <View style={styles.crown}>
              <Crown size={10} color="#FFF" strokeWidth={3} />
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.name} numberOfLines={1}>{member.display_name}</Text>
            {isSelf ? <Text style={styles.youPill}>You</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot status={status} />
            <Text style={[styles.statusLabel, isPaid && { color: '#22C55E' }, isFailed && { color: '#EF4444' }]}>
              {status === 'paid' && 'Paid'}
              {status === 'covered' && 'Covered by host'}
              {status === 'pending' && amount > 0 && 'Awaiting payment'}
              {status === 'pending' && amount === 0 && 'Nothing owed'}
              {status === 'failed' && 'Payment failed'}
              {status === 'cancelled' && 'Cancelled'}
              {status === 'refunded' && 'Refunded'}
              {status === 'idle' && 'Waiting'}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.amount, isPaid && { color: '#22C55E' }]}>{formatCents(amount)}</Text>
          {showCoverButton && !isPaid && amount > 0 && !isSelf ? (
            <Pressable onPress={onCover} style={styles.coverBtn}>
              <Text style={styles.coverBtnText}>Pay for them</Text>
            </Pressable>
          ) : null}
          {isFailed && isSelf && onRetry ? (
            <Pressable onPress={onRetry} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function PartyLedger(props: {
  members: PartyMember[];
  payments: PartyPayment[];
  selfMemberId: string | null;
  isHost: boolean;
  onCoverMember?: (memberId: string) => void;
  onRetry?: () => void;
  onMemberTap?: (memberId: string) => void;
}) {
  const styles = usePartyLedgerStyles();
  const { colors } = useAppTheme();
  const { members, payments, selfMemberId, isHost, onCoverMember, onRetry, onMemberTap } = props;

  const paidCount = useMemo(
    () => payments.filter((p) => p.status === 'paid' || p.status === 'covered').length,
    [payments],
  );
  const totalCount = payments.filter((p) => p.amount_cents > 0 || p.status === 'paid' || p.status === 'covered').length;
  const progressPct = totalCount === 0 ? 0 : Math.round((paidCount / totalCount) * 100);

  return (
    <Animated.View entering={FadeIn} style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>Who's paid</Text>
          <Text style={styles.headerSub}>Tap a name to see what they ordered</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.progressText}>
            <Text style={{ color: '#22C55E' }}>{paidCount}</Text>
            <Text style={{ color: colors.textMuted }}>{` of ${totalCount}`}</Text>
          </Text>
          <Text style={styles.progressMeta}>{progressPct}% there</Text>
        </View>
      </View>
      <View style={styles.progressBar}>
        <Animated.View
          layout={Layout.springify()}
          style={[styles.progressFill, { width: `${progressPct}%` }]}
        />
      </View>
      <View style={{ marginTop: 10 }}>
        {members.map((m, idx) => {
          const pay = payments.find((p) => p.member_id === m.id);
          const isSelf = m.id === selfMemberId;
          return (
            <LedgerRow
              key={m.id}
              member={m}
              payment={pay}
              index={idx}
              isSelf={isSelf}
              isHost={isHost}
              showCoverButton={isHost && !isSelf}
              onCover={() => onCoverMember?.(m.id)}
              onRetry={onRetry}
              onPress={onMemberTap ? () => onMemberTap(m.id) : undefined}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

