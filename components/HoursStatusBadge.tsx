import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    Modal,
    TouchableOpacity,
    ScrollView,
    Platform,
} from 'react-native';
import { X, Clock } from 'lucide-react-native';
import { Settings } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { RestaurantStatusResult, RestaurantOpenStatus, RestaurantHour } from '@/lib/restaurant-hours';

interface HoursStatusBadgeProps {
    statusResult: RestaurantStatusResult | null;
    /** Full hours array — when provided the badge becomes tappable */
    hours?: RestaurantHour[];
    /** 'sm' = compact (for cards/lists), 'md' = default, 'lg' = hero/detail view */
    size?: 'sm' | 'md' | 'lg';
    /** Optional manage action for owners/admins */
    onManageHoursPress?: () => void;
}

const STATUS_COLORS: Record<RestaurantOpenStatus, { dot: string; bg: string; text: string }> = {
    open:         { dot: '#22C55E', bg: 'rgba(34,197,94,0.12)',  text: '#22C55E' },
    opening_soon: { dot: '#F59E0B', bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
    closing_soon: { dot: '#F59E0B', bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
    closed:       { dot: '#EF4444', bg: 'rgba(239,68,68,0.12)',  text: '#EF4444' },
};

const FONT_SIZES = { sm: 10, md: 12, lg: 13 } as const;
const DOT_SIZES  = { sm: 5,  md: 6,  lg: 7  } as const;
const H_PADDING  = { sm: 6,  md: 8,  lg: 10 } as const;
const V_PADDING  = { sm: 2,  md: 3,  lg: 4  } as const;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtTime(t: string): string {
    // t = 'HH:MM:SS' or 'HH:MM'
    const [hStr, mStr] = t.split(':');
    let h = Number(hStr);
    const m = Number(mStr);
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTodayDow(): number {
    // Use Intl to get CST day of week
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            weekday: 'short',
        });
        const short = formatter.format(new Date());
        return DAY_SHORT.indexOf(short);
    } catch {
        return new Date().getDay();
    }
}

import { useAppTheme } from '@/lib/app-theme';

export function HoursStatusBadge({ statusResult, hours, size = 'md', onManageHoursPress }: HoursStatusBadgeProps) {
    const [showModal, setShowModal] = useState(false);
    const { colors: colorsTheme, isDark } = useAppTheme();

    if (!statusResult) return null;

    const { status, label } = statusResult;
    const colors   = STATUS_COLORS[status];
    const fontSize = FONT_SIZES[size];
    const dotSize  = DOT_SIZES[size];
    const hPad     = H_PADDING[size];
    const vPad     = V_PADDING[size];
    const isClickable = !!(hours && hours.length > 0);
    const todayDow = getTodayDow();

    // Build a map: dow → sorted list of (open, close) pairs
    const schedule: Record<number, { open: string; close: string }[]> = {};
    if (hours) {
        for (const row of hours) {
            if (!schedule[row.day_of_week]) schedule[row.day_of_week] = [];
            schedule[row.day_of_week].push({ open: row.open_time, close: row.close_time });
        }
    }

    const pill = (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'flex-start',
                backgroundColor: colors.bg,
                borderRadius: 20,
                paddingHorizontal: hPad,
                paddingVertical: vPad,
                gap: 5,
                borderWidth: isClickable ? 1 : 0,
                borderColor: isClickable ? colors.dot + '55' : 'transparent',
            }}
        >
            <View
                style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: colors.dot,
                }}
            />
            <Text
                style={{
                    fontFamily: 'Manrope_600SemiBold',
                    color: colors.text,
                    fontSize,
                }}
                numberOfLines={1}
            >
                {label}
            </Text>
            {isClickable && (
                <Clock size={fontSize - 1} color={colors.text} strokeWidth={2} />
            )}
        </View>
    );

    return (
        <>
            {isClickable ? (
                <Pressable
                    onPress={() => {
                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                        setShowModal(true);
                    }}
                    hitSlop={8}
                >
                    {pill}
                </Pressable>
            ) : pill}

            {/* Hours Schedule Modal */}
            <Modal
                visible={showModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowModal(false)}
            >
                <TouchableOpacity
                    activeOpacity={1}
                    onPress={() => setShowModal(false)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
                >
                    <TouchableOpacity activeOpacity={1} onPress={() => {}}>
                        <View
                            style={{
                                backgroundColor: colorsTheme.card,
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: colorsTheme.cardBorder,
                                width: 300,
                                overflow: 'hidden',
                            }}
                        >
                            {/* Header */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colorsTheme.cardBorder }}>
                                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: colorsTheme.text, fontSize: 16 }}>
                                    Hours
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    {onManageHoursPress && (
                                        <Pressable
                                            onPress={() => {
                                                if (Platform.OS !== 'web') Haptics.selectionAsync();
                                                setShowModal(false);
                                                onManageHoursPress();
                                            }}
                                            hitSlop={12}
                                        >
                                            <Settings size={18} color="#FF9933" />
                                        </Pressable>
                                    )}
                                    <Pressable
                                        onPress={() => {
                                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                                            setShowModal(false);
                                        }}
                                        hitSlop={12}
                                    >
                                        <X size={18} color={colorsTheme.textMuted} />
                                    </Pressable>
                                </View>
                            </View>

                            {/* Schedule rows */}
                            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: 8 }}>
                                {DAY_NAMES.map((dayName, dow) => {
                                    const isToday = dow === todayDow;
                                    const slots   = schedule[dow];
                                    return (
                                        <View
                                            key={dow}
                                            style={{
                                                flexDirection: 'row',
                                                justifyContent: 'space-between',
                                                alignItems: 'flex-start',
                                                paddingHorizontal: 18,
                                                paddingVertical: 9,
                                                backgroundColor: isToday ? (isDark ? 'rgba(255,153,51,0.06)' : 'rgba(245,158,11,0.1)') : 'transparent',
                                                borderLeftWidth: isToday ? 2 : 0,
                                                borderLeftColor: '#FF9933',
                                            }}
                                        >
                                            <Text style={{
                                                fontFamily: isToday ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                                color: isToday ? '#FF9933' : colorsTheme.textMuted,
                                                fontSize: 13,
                                                width: 90,
                                            }}>
                                                {dayName}
                                            </Text>
                                            <View style={{ alignItems: 'flex-end', flex: 1 }}>
                                                {slots && slots.length > 0 ? (
                                                    slots.map((s, i) => (
                                                        <Text key={i} style={{
                                                            fontFamily: isToday ? 'Manrope_600SemiBold' : 'Manrope_400Regular',
                                                            color: isToday ? colorsTheme.text : colorsTheme.textMuted,
                                                            fontSize: 13,
                                                        }}>
                                                            {fmtTime(s.open)} – {fmtTime(s.close)}
                                                        </Text>
                                                    ))
                                                ) : (
                                                    <Text style={{ fontFamily: 'Manrope_500Medium', color: colorsTheme.textMuted, fontSize: 13 }}>
                                                        Closed
                                                    </Text>
                                                )}
                                            </View>
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>
        </>
    );
}
