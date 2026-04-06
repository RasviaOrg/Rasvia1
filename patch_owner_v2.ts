import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', 'utf-8');

// 1. Add imports
content = content.replace(
    /import { SafeAreaView } from "react-native-safe-area-context";/,
    `import DateTimePicker from "@react-native-community/datetimepicker";
import { getStartDate, getEndDate } from "../dateTools";
import { SafeAreaView } from "react-native-safe-area-context";`
);
content = content.replace(
    /import {\n    Clock,/,
    `import {\n    Calendar,\n    Clock,`
);

// 2. Rename TodayBreakdownModal to OverallBreakdownModal and update state & props
content = content.replace(
    /function TodayBreakdownModal\(\{ restaurantId, onClose \}: \{ restaurantId: string; onClose: \(\) => void \}\) \{/,
    `function OverallBreakdownModal({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
    const [period, setPeriod] = useState<"All" | "Last Month" | "Last Week" | "Today" | "Custom">("Today");
    const [customDate, setCustomDate] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);`
);
content = content.replace(/<TodayBreakdownModal/g, '<OverallBreakdownModal');

// 3. Update query logic
content = content.replace(
    /                    \.eq\("restaurant_id", restaurantId\)\n                    \.gte\("created_at", todayStart\(\)\)\n                    \.neq\("status", "cancelled"\);/,
    `                    .eq("restaurant_id", restaurantId);

                const start = getStartDate(period, customDate);
                const end = getEndDate(period, customDate);

                if (start) query = query.gte("created_at", start);
                if (end) query = query.lte("created_at", end);

                const { data: todayOrdersData } = await query;`
);

content = content.replace(
    /                const { data: todayOrdersData } = await supabase\n                    \.from\("orders"\)\n                    \.select\("id, customer_name, status, subtotal, created_at, order_type"\)\n                    \.eq\("restaurant_id", restaurantId\);/g,
    `                let query = supabase
                    .from("orders")
                    .select("id, customer_name, status, subtotal, created_at, order_type")
                    .eq("restaurant_id", restaurantId);`
);

// 4. Update order filtering (remove cancel filter)
content = content.replace(
    /                const parsedOrders = \(\(todayOrdersData as Order\[\]\) \?\? \[\]\)\.filter\(\n                    \(o\) => o\.status !== "cancelled"\n                \);/g,
    `                const parsedOrders = ((todayOrdersData as Order[]) ?? []);`
);

// 5. Update dependency array
content = content.replace(
    /        fetchBreakdown\(\);\n    \}, \[restaurantId\]\);/,
    `        fetchBreakdown();\n    }, [restaurantId, period, customDate]);`
);


// 6. Update UI
content = content.replace(
    /Today's Breakdown\n                        <\/Text>\n                        <Text style=\{\{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#777", marginTop: 3 \}\}>\n                            Excludes cancelled orders\n                        <\/Text>/,
    `Overall Breakdown
                        </Text>
                    </View>
                    <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
                        <X size={22} color="#aaa" />
                    </Pressable>
                </View>

                {/* Period Selector Tabs */}
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 40 }}>
                        {(["All", "Last Month", "Last Week", "Today", "Custom"] as const).map((p) => {
                            const isSelected = period === p;
                            return (
                                <Pressable
                                    key={p}
                                    onPress={() => {
                                        if (Platform.OS !== "web") Haptics.selectionAsync();
                                        if (p === "Custom") setShowDatePicker(true);
                                        setPeriod(p);
                                    }}
                                    style={{
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 999,
                                        backgroundColor: isSelected ? "rgba(255,153,51,0.15)" : "#1a1a1a",
                                        borderWidth: 1,
                                        borderColor: isSelected ? ORANGE : "#2a2a2a",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 6,
                                    }}
                                >
                                    {p === "Custom" && <Calendar size={14} color={isSelected ? ORANGE : "#888"} />}
                                    <Text style={{
                                        fontFamily: "Manrope_600SemiBold",
                                        fontSize: 13,
                                        color: isSelected ? ORANGE : "#aaa"
                                    }}>
                                        {p === "Custom" && period === "Custom" ? customDate.toLocaleDateString() : p}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {showDatePicker && (
                    <DateTimePicker
                        value={customDate}
                        mode="date"
                        display={Platform.OS === "ios" ? "inline" : "default"}
                        themeVariant="dark"
                        onChange={(event, date) => {
                            if (Platform.OS === "android") setShowDatePicker(false);
                            if (date) {
                                setCustomDate(date);
                                setPeriod("Custom");
                            }
                        }}
                    />
                )}

                {Platform.OS === "ios" && showDatePicker && (
                    <Pressable
                        onPress={() => setShowDatePicker(false)}
                        style={{ alignSelf: "center", paddingVertical: 10, paddingHorizontal: 20, backgroundColor: "#2a2a2a", borderRadius: 8, marginBottom: 10 }}
                    >
                        <Text style={{ color: "#fff", fontFamily: "Manrope_600SemiBold" }}>Done</Text>
                    </Pressable>
                )}
                
                <View style={{ display: "none" }}>
                    <View>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                            Overall Breakdown
                        </Text>`
);

content = content.replace(
    /\{totalItems\} items sold today/,
    `{totalItems} items sold`
);

writeFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', content);
