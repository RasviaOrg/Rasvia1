import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  Platform,
} from "react-native";
import { Star, Flag, CheckCircle2, CircleX } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAppTheme } from "@/lib/app-theme";

type SortMode = "newest" | "highest" | "lowest";

type OwnerReview = {
  id: number;
  rating: number;
  body: string | null;
  reviewer_name: string;
  created_at: string;
  is_verified_purchase: boolean;
  is_from_google: boolean;
};

type ReviewReportLite = {
  id: number;
  review_id: number;
  status: "pending" | "declined";
  admin_message: string | null;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StarRow({ rating }: { rating: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          size={13}
          color={colors.saffron}
          fill={value <= rating ? colors.saffron : "transparent"}
        />
      ))}
    </View>
  );
}

export function OwnerReviewsPanel({
  restaurantId,
  isAdminView,
}: {
  restaurantId: string;
  isAdminView: boolean;
}) {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const [reviews, setReviews] = useState<OwnerReview[]>([]);
  const [reportsByReviewId, setReportsByReviewId] = useState<Map<number, ReviewReportLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("lowest");
  const [submittingReviewId, setSubmittingReviewId] = useState<number | null>(null);

  const fetchReviewData = useCallback(async (asRefresh = false) => {
    if (!restaurantId) {
      setReviews([]);
      setReportsByReviewId(new Map());
      setLoading(false);
      return;
    }

    if (asRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const reviewsPromise = supabase
        .from("restaurant_reviews")
        .select("id, rating, body, reviewer_name, created_at, is_verified_purchase, is_from_google")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });

      const reportsPromise = session?.user?.id
        ? supabase
            .from("review_reports")
            .select("id, review_id, status, admin_message, created_at")
            .eq("restaurant_id", restaurantId)
            .eq("owner_user_id", session.user.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any);

      const [{ data: reviewRows, error: reviewError }, { data: reportRows }] = await Promise.all([
        reviewsPromise,
        reportsPromise,
      ]);

      if (reviewError) throw reviewError;

      setReviews((reviewRows as OwnerReview[]) ?? []);

      const latestByReview = new Map<number, ReviewReportLite>();
      for (const report of ((reportRows ?? []) as ReviewReportLite[])) {
        if (!latestByReview.has(report.review_id)) {
          latestByReview.set(report.review_id, report);
        }
      }
      setReportsByReviewId(latestByReview);
    } catch (error) {
      console.error("OwnerReviewsPanel fetch error", error);
      Alert.alert("Error", "Could not load reviews right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, session?.user?.id]);

  useEffect(() => {
    void fetchReviewData(false);
  }, [fetchReviewData]);

  const sortedReviews = useMemo(() => {
    const list = [...reviews];
    if (sortMode === "highest") {
      list.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return list;
    }
    if (sortMode === "lowest") {
      list.sort((a, b) => {
        if (a.rating !== b.rating) return a.rating - b.rating;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return list;
    }
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  }, [reviews, sortMode]);

  const handleReport = useCallback((review: OwnerReview) => {
    if (isAdminView) {
      Alert.alert("Unavailable", "Switch to the owner account to submit review reports.");
      return;
    }
    Alert.alert(
      "Report this review?",
      "This sends the review to admins for moderation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            setSubmittingReviewId(review.id);
            try {
              const { error } = await supabase.rpc("submit_review_report", {
                p_review_id: review.id,
                p_reason: "Low-star review reported from owner portal",
              });
              if (error) throw error;
              if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              await fetchReviewData(false);
            } catch (err: any) {
              Alert.alert("Could not report", err?.message ?? "Please try again.");
            } finally {
              setSubmittingReviewId(null);
            }
          },
        },
      ]
    );
  }, [fetchReviewData, isAdminView]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: colors.text }}>
          Reviews
        </Text>
        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
          Sort by stars and report low-star reviews for admin moderation.
        </Text>
        {isAdminView ? (
          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            Admin preview mode: submit actions are disabled.
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        {([
          { key: "lowest", label: "Lowest" },
          { key: "highest", label: "Highest" },
          { key: "newest", label: "Newest" },
        ] as const).map((option) => {
          const active = sortMode === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setSortMode(option.key);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? "rgba(255,153,51,0.38)" : colors.cardBorder,
                backgroundColor: active ? "rgba(255,153,51,0.14)" : colors.background,
              }}
            >
              <Text
                style={{
                  fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                  color: active ? colors.saffron : colors.textMuted,
                  fontSize: 12,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ paddingVertical: 30, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.saffron} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void fetchReviewData(true);
              }}
              tintColor={colors.saffron}
              colors={[colors.saffron]}
            />
          }
        >
          {sortedReviews.length === 0 ? (
            <Text
              style={{
                textAlign: "center",
                color: colors.textMuted,
                fontFamily: "Manrope_500Medium",
                paddingVertical: 24,
              }}
            >
              No reviews yet.
            </Text>
          ) : (
            sortedReviews.map((review) => {
              const report = reportsByReviewId.get(review.id);
              const canReport = review.rating <= 3;
              const pending = report?.status === "pending";
              const declined = report?.status === "declined";
              const disableReport = submittingReviewId === review.id || pending || isAdminView;

              return (
                <View
                  key={review.id}
                  style={{
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    backgroundColor: colors.background,
                    padding: 14,
                    marginBottom: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontFamily: "Manrope_700Bold",
                          color: colors.text,
                          fontSize: 13,
                        }}
                        numberOfLines={1}
                      >
                        {review.reviewer_name || "Anonymous"}
                      </Text>
                      <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                        {formatDate(review.created_at)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <StarRow rating={review.rating} />
                      <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: colors.textMuted, fontSize: 11 }}>
                        {review.rating.toFixed(1)}
                      </Text>
                    </View>
                  </View>

                  {!!review.body && (
                    <Text
                      style={{
                        marginTop: 10,
                        color: colors.textSecondary,
                        fontFamily: "Manrope_500Medium",
                        fontSize: 13,
                        lineHeight: 19,
                      }}
                    >
                      {review.body}
                    </Text>
                  )}

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {review.is_verified_purchase ? (
                      <View style={{ backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.3)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 10 }}>
                          Verified
                        </Text>
                      </View>
                    ) : null}
                    {review.is_from_google ? (
                      <View style={{ backgroundColor: "rgba(59,130,246,0.12)", borderWidth: 1, borderColor: "rgba(59,130,246,0.3)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#60A5FA", fontSize: 10 }}>
                          Google
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {canReport ? (
                    <View style={{ marginTop: 12 }}>
                      {pending ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <CheckCircle2 size={14} color="#22C55E" />
                          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 12 }}>
                            Report submitted to admins
                          </Text>
                        </View>
                      ) : declined ? (
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <CircleX size={14} color="#EF4444" />
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#EF4444", fontSize: 12 }}>
                              Admin declined this report
                            </Text>
                          </View>
                          {report?.admin_message ? (
                            <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                              Reason: {report.admin_message}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => handleReport(review)}
                          disabled={disableReport}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 7,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: "rgba(239,68,68,0.4)",
                            backgroundColor: "rgba(239,68,68,0.14)",
                            paddingVertical: 10,
                            opacity: disableReport ? 0.6 : 1,
                          }}
                        >
                          {submittingReviewId === review.id ? (
                            <ActivityIndicator size="small" color="#F87171" />
                          ) : (
                            <Flag size={14} color="#F87171" />
                          )}
                          <Text style={{ fontFamily: "Manrope_700Bold", color: "#F87171", fontSize: 12 }}>
                            Report low-star review
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
