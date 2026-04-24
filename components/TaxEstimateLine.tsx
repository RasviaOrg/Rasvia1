import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useAppTheme } from "@/lib/app-theme";
import { formatCentsUsd } from "@/lib/texas-sales-tax-estimate";

interface TaxEstimateLineProps {
  /** Pre-tax subtotal in dollars (e.g. 16.44). */
  subtotalDollars: number;
  /** Pass the exact tax cents resolved from Stripe Tax API. If null, UI shows a loader. */
  taxCents: number | null;
  /** Override font size for the amount (default 14). */
  amountFontSize?: number;
  /** If true, also render an "Total" row below. */
  showTotal?: boolean;
}

/**
 * Renders down-to-the-penny accurate Taxes.
 */
export function TaxEstimateLine({
  subtotalDollars,
  taxCents,
  amountFontSize = 14,
  showTotal = false,
}: TaxEstimateLineProps) {
  const { colors } = useAppTheme();

  const subtotalCents = Math.round(Math.max(0, subtotalDollars) * 100);
  const totalCents = taxCents !== null ? subtotalCents + taxCents : null;

  return (
    <View>
      {/* ── Tax line ── */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <Text
          style={{
            fontFamily: "Manrope_600SemiBold",
            color: colors.textMuted,
            fontSize: 14,
          }}
        >
          Sales Tax
        </Text>
        {taxCents === null ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Text
            style={{
              fontFamily: "JetBrainsMono_600SemiBold",
              color: colors.text,
              fontSize: amountFontSize,
            }}
          >
            {formatCentsUsd(taxCents)}
          </Text>
        )}
      </View>

      {/* ── Total ── */}
      {showTotal && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
          <Text
            style={{
              fontFamily: "Manrope_700Bold",
              color: colors.text,
              fontSize: 15,
            }}
          >
            Total
          </Text>
          {totalCents === null ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Text
              style={{
                fontFamily: "JetBrainsMono_600SemiBold",
                color: colors.text,
                fontSize: 17,
              }}
            >
              {formatCentsUsd(totalCents)}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
