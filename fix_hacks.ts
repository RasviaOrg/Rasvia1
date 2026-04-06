import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', 'utf-8');

// remove the hacky display: none block I added
const hack = `<View style={{ display: "none" }}>
                    <View>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                            Overall Breakdown
                        </Text>
                    </View>
                    <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
                        <X size={22} color="#aaa" />
                    </Pressable>
                </View>`;

content = content.replace(hack, '');
writeFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', content);
