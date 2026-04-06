import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', 'utf-8');

// 1. Update PulseItemBreakdown type
content = content.replace(
    /type PulseItemBreakdown = \{\n    name: string;\n    quantity: number;\n    revenue: number;\n    orderCount: number;\n\};/,
    `type PulseItemBreakdown = {
    name: string;
    quantity: number;
    revenue: number;
    orderCount: number;
    dateOfOrder?: string;
};`
);

// 2. Add initialPeriod prop
content = content.replace(
    /function OverallBreakdownModal\(\{ restaurantId, onClose \}: \{ restaurantId: string; onClose: \(\) => void \}\) \{/,
    `function OverallBreakdownModal({ restaurantId, onClose, initialPeriod = "Today" }: { restaurantId: string; onClose: () => void; initialPeriod?: "All" | "Last Month" | "Last Week" | "Today" | "Custom" }) {`
);

// 3. Initialize period with initialPeriod
content = content.replace(
    /const \[period, setPeriod\] = useState<"All" \| "Last Month" \| "Last Week" \| "Today" \| "Custom">\(("Today")?\);/,
    `const [period, setPeriod] = useState<"All" | "Last Month" | "Last Week" | "Today" | "Custom">(initialPeriod);`
);

// 4. Update grouping logic in fetchBreakdown
content = content.replace(
    /                const agg = new Map<string, PulseItemBreakdown>\(\);\n                const byOrder = new Map<string, Set<number>>\(\);/,
    `                const agg = new Map<string, PulseItemBreakdown>();
                const byOrder = new Map<string, Set<number>>();
                
                const shouldGroupByDay = period !== "Today" && period !== "Custom";
                const orderDates = new Map<number, string>();
                parsedOrders.forEach(o => {
                    const d = new Date(o.created_at);
                    orderDates.set(o.id, d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
                });`
);

content = content.replace(
    /                    const orderId = Number\(row\.order_id\);\n\n                    const existing = agg\.get\(key\) \?\? \{/g,
    `                    const orderId = Number(row.order_id);

                    const dateStr = orderDates.get(orderId) || "";
                    const loopKey = shouldGroupByDay ? \`\${key}|||\${dateStr}\` : key;

                    const existing = agg.get(loopKey) ?? {`
);

content = content.replace(
    /                    \}\;\n                    existing\.quantity \+= quantity\;\n                    existing\.revenue \+= quantity \* price;\n                    agg\.set\(key, existing\);/,
    `                        ...(shouldGroupByDay ? { dateOfOrder: dateStr } : {}),
                    };
                    existing.quantity += quantity;
                    existing.revenue += quantity * price;
                    agg.set(loopKey, existing);`
);

content = content.replace(
    /                    const seenOrders = byOrder\.get\(key\) \?\? new Set<number>\(\);\n                    seenOrders\.add\(orderId\);\n                    byOrder\.set\(key, seenOrders\);/g,
    `                    const seenOrders = byOrder.get(loopKey) ?? new Set<number>();
                    seenOrders.add(orderId);
                    byOrder.set(loopKey, seenOrders);`
);

content = content.replace(
    /                    orderCount: byOrder\.get\(key\)\?\.size \?\? 0,/g,
    `                    orderCount: byOrder.get(key)?.size ?? 0,`
);

// 5. Update items map component to show date
content = content.replace(
    /                                            <Text style=\{\{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12 \}\}>\n                                                \{item\.quantity\} sold \· \{item\.orderCount\} orders\n                                            <\/Text>/,
    `                                            <View>
                                                <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12 }}>
                                                    {item.quantity} sold · {item.orderCount} orders
                                                </Text>
                                                {item.dateOfOrder && (
                                                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12, marginTop: 2 }}>
                                                        {item.dateOfOrder}
                                                    </Text>
                                                )}
                                            </View>`
);

// 6. Update showPulseBreakdown state and defaults
content = content.replace(
    /const \[showPulseBreakdown, setShowPulseBreakdown\] = useState\(false\);/,
    `const [showPulseBreakdown, setShowPulseBreakdown] = useState<false | "All" | "Today">(false);`
);

// We need to replace three setShowPulseBreakdown(true) instances:
// The first one is in Section 1 (Manage Timings block) line ~ 1302
// We can use a regex that matches the string "View Breakdown" slightly below it.

content = content.replace(
    /setShowPulseBreakdown\(true\);\n                            \}\}\n                            style=\{[\s\S]*?View Breakdown/,
    `setShowPulseBreakdown("All");\n                            }}\n                            style={({ pressed }) => ({\n                                flex: 1,\n                                borderRadius: 12,\n                                borderWidth: 1,\n                                borderColor: "rgba(34,197,94,0.30)",\n                                backgroundColor: "rgba(34,197,94,0.10)",\n                                paddingVertical: 11,\n                                alignItems: "center",\n                                opacity: pressed ? 0.85 : 1,\n                            })}\n                        >\n                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: "#22C55E" }}>\n                                View Breakdown`
);

content = content.replace(
    /setShowPulseBreakdown\(true\);\n                            \}\}\n                            hitSlop=\{10\}[\s\S]*?Breakdown/,
    `setShowPulseBreakdown("Today");\n                            }}\n                            hitSlop={10}\n                            style={({ pressed }) => ({\n                                opacity: pressed ? 0.65 : 1,\n                                backgroundColor: "rgba(255,153,51,0.15)",\n                                borderColor: "rgba(255,153,51,0.35)",\n                                borderWidth: 1,\n                                borderRadius: 999,\n                                paddingHorizontal: 12,\n                                paddingVertical: 7,\n                                flexDirection: "row",\n                                alignItems: "center",\n                                gap: 6,\n                            })}\n                        >\n                            <BarChart3 size={13} color={ORANGE} />\n                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: ORANGE }}>\n                                Breakdown`
);

content = content.replace(
    /setShowPulseBreakdown\(true\);\n                            \}\}\n                            style=\{[\s\S]*?Open combined breakdown/,
    `setShowPulseBreakdown("Today");\n                            }}\n                            style={({ pressed }) => ({\n                                marginTop: 24,\n                                borderRadius: 12,\n                                borderWidth: 1,\n                                borderColor: pressed ? "#3f3f3f" : "#2f2f2f",\n                                backgroundColor: pressed ? "#1a1a1a" : "#131313",\n                                paddingHorizontal: 16,\n                                paddingVertical: 14,\n                                flexDirection: "row",\n                                alignItems: "center",\n                                justifyContent: "space-between",\n                            })}\n                        >\n                            <View>\n                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 15, color: "#f5f5f5" }}>\n                                    Open combined breakdown`
);

content = content.replace(
    /<OverallBreakdownModal\n                    restaurantId=\{effectiveOwnerRestaurantId\}\n                    onClose=\{\(\) => setShowPulseBreakdown\(false\)\}\n                \/>/,
    `<OverallBreakdownModal
                    initialPeriod={showPulseBreakdown === "All" ? "All" : "Today"}
                    restaurantId={effectiveOwnerRestaurantId}
                    onClose={() => setShowPulseBreakdown(false)}
                />`
);

writeFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', content);

