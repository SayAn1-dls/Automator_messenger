import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ReplyLog } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

const STATUS_META = {
  sent: { icon: "checkmark-circle" as const, color: colors.green, label: "Sent" },
  skipped: { icon: "remove-circle-outline" as const, color: colors.textSecondary, label: "Skipped" },
  failed: { icon: "alert-circle" as const, color: colors.danger, label: "Failed" },
};

export default function LogsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [logs, setLogs] = useState<ReplyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLogs(await api<ReplyLog[]>("/logs"));
    } catch {
      // keep previous logs on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renderLog = ({ item }: { item: ReplyLog }) => {
    const meta = STATUS_META[item.status];
    return (
      <View style={styles.logCard} testID={`log-entry-${item.id}`}>
        <View style={styles.logTop}>
          <View
            style={[
              styles.sourceBadge,
              item.source === "whatsapp" && styles.sourceBadgeWa,
            ]}
          >
            <MaterialCommunityIcons
              name={item.source === "whatsapp" ? "whatsapp" : "flask-outline"}
              size={11}
              color={item.source === "whatsapp" ? "#052E24" : colors.amber}
            />
            <Text
              style={[
                styles.sourceBadgeText,
                item.source === "whatsapp" && { color: "#052E24" },
              ]}
            >
              {item.source === "whatsapp" ? "WhatsApp" : "Simulator"}
            </Text>
          </View>
          <Text style={styles.logContact} numberOfLines={1}>
            {item.contact_name || "Unknown"}
          </Text>
          <Text style={styles.logTime}>
            {dayjs(item.created_at).format("DD/MM h:mm A")}
          </Text>
        </View>

        <View style={styles.msgRow}>
          <Ionicons name="arrow-down" size={12} color={colors.textSecondary} />
          <Text style={styles.incomingText} numberOfLines={2}>
            {item.incoming_text}
          </Text>
        </View>
        {item.reply_text ? (
          <View style={styles.msgRow}>
            <MaterialCommunityIcons name="robot" size={12} color={colors.green} />
            <Text style={styles.replyText} numberOfLines={3}>
              {item.reply_text}
            </Text>
          </View>
        ) : null}

        <View style={styles.statusRow}>
          <Ionicons name={meta.icon} size={13} color={meta.color} />
          <Text style={[styles.statusText, { color: meta.color }]}>
            {meta.label}
            {item.reason ? ` · ${item.reason}` : ""}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container} testID="logs-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          testID="logs-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{ padding: 4 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Auto-reply history</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.center} testID="logs-empty-state">
          <Ionicons name="time-outline" size={44} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>
            Every auto-reply the agent sends (or skips) shows up here — from
            the simulator and live WhatsApp.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="logs-list"
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={renderLog}
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.green}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.header,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.md },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  logCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: spacing.sm,
  },
  logTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.elevated,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  sourceBadgeWa: { backgroundColor: colors.green },
  sourceBadgeText: { color: colors.amber, fontSize: 10, fontWeight: "700" },
  logContact: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  logTime: { color: colors.textSecondary, fontSize: 10 },
  msgRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    alignItems: "flex-start",
  },
  incomingText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
  replyText: { color: colors.text, fontSize: 12, flex: 1, lineHeight: 17 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  statusText: { fontSize: 11, fontWeight: "600", flex: 1 },
});
