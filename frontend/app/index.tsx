import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Contact } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

const AVATAR_COLORS = ["#00A884", "#53BDEB", "#FFD279", "#F15C6D", "#A38BFE"];

function avatarColor(name: string) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = dayjs(iso);
  return d.isSame(dayjs(), "day") ? d.format("h:mm A") : d.format("DD/MM/YY");
}

function delayLabel(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [awayMode, setAwayMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [contactsRes, settingsRes, waRes] = await Promise.all([
        api<Contact[]>("/contacts"),
        api<{ away_mode: boolean }>("/settings"),
        api<{ connected: boolean }>("/whatsapp/config"),
      ]);
      setContacts(contactsRes);
      setAwayMode(settingsRes.away_mode);
      setWaConnected(waRes.connected);
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load chats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const toggleAway = async (value: boolean) => {
    setAwayMode(value);
    try {
      await api("/settings", {
        method: "PATCH",
        body: JSON.stringify({ away_mode: value }),
      });
    } catch {
      setAwayMode(!value);
    }
  };

  const loadDemo = async () => {
    setDemoLoading(true);
    try {
      await api("/demo", { method: "POST" });
      await loadData();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Demo failed to load");
    } finally {
      setDemoLoading(false);
    }
  };

  const renderContact = ({ item }: { item: Contact }) => (
    <Pressable
      testID={`contact-row-${item.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/chat/${item.id}`)}
    >
      <View style={[styles.avatar, { backgroundColor: avatarColor(item.name) }]}>
        <Text style={styles.avatarText}>
          {item.name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowTime}>{formatTime(item.last_message_at)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {item.last_message ||
              (item.analysis_status === "analyzing"
                ? "Analyzing your style…"
                : "Tap to test your AI agent")}
          </Text>
          <View
            style={[
              styles.agentBadge,
              !item.auto_reply_enabled && styles.agentBadgeOff,
            ]}
          >
            <Ionicons
              name="flash"
              size={10}
              color={item.auto_reply_enabled ? "#052E24" : colors.textSecondary}
            />
            <Text
              style={[
                styles.agentBadgeText,
                !item.auto_reply_enabled && styles.agentBadgeTextOff,
              ]}
            >
              {item.auto_reply_enabled
                ? delayLabel(item.auto_reply_delay_seconds)
                : "off"}
            </Text>
          </View>
        </View>
      </View>
      <Pressable
        testID={`contact-info-button-${item.id}`}
        hitSlop={8}
        style={styles.infoButton}
        onPress={() => router.push(`/contact/${item.id}`)}
      >
        <Ionicons
          name="information-circle-outline"
          size={22}
          color={colors.textSecondary}
        />
      </Pressable>
    </Pressable>
  );

  return (
    <View style={styles.container} testID="chats-screen">
      <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>EchoPilot</Text>
            <Text style={styles.brandSub}>Your WhatsApp AI agent</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              testID="logs-button"
              onPress={() => router.push("/logs")}
              hitSlop={8}
              style={styles.headerIcon}
            >
              <Ionicons name="time-outline" size={21} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              testID="connect-button"
              onPress={() => router.push("/connect")}
              hitSlop={8}
              style={styles.headerIcon}
            >
              <Ionicons
                name="logo-whatsapp"
                size={21}
                color={waConnected ? colors.green : colors.textSecondary}
              />
            </Pressable>
            <View style={styles.awayPill}>
            <Ionicons
              name={awayMode ? "moon" : "person"}
              size={14}
              color={awayMode ? colors.green : colors.textSecondary}
            />
            <Text
              style={[styles.awayLabel, awayMode && { color: colors.green }]}
            >
              Away
            </Text>
            <Switch
              testID="away-mode-switch"
              value={awayMode}
              onValueChange={toggleAway}
              trackColor={{ false: "#374248", true: colors.greenDark }}
              thumbColor={awayMode ? colors.green : "#8696A0"}
            />
            </View>
          </View>
        </View>
        <View
          style={[
            styles.awayBanner,
            { backgroundColor: awayMode ? colors.greenSoft : colors.elevated },
          ]}
        >
          <Ionicons
            name={awayMode ? "shield-checkmark" : "shield-outline"}
            size={16}
            color={awayMode ? colors.green : colors.textSecondary}
          />
          <Text style={styles.awayBannerText} testID="away-banner-text">
            {awayMode
              ? "Agent is active — unseen messages get an AI reply in your style"
              : "Away mode off — the agent will not auto-reply"}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : contacts.length === 0 ? (
        <View style={styles.center} testID="empty-state">
          <View style={styles.emptyIconWrap}>
            <Ionicons name="chatbubbles" size={44} color={colors.green} />
          </View>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptyText}>
            Import a WhatsApp chat export (.txt) and the agent will learn
            exactly how you talk with that person.
          </Text>
          <Pressable
            testID="empty-import-button"
            style={styles.primaryButton}
            onPress={() => router.push("/import")}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#052E24" />
            <Text style={styles.primaryButtonText}>Import a chat</Text>
          </Pressable>
          <Pressable
            testID="load-demo-button"
            style={styles.secondaryButton}
            onPress={loadDemo}
            disabled={demoLoading}
          >
            {demoLoading ? (
              <ActivityIndicator color={colors.green} size="small" />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color={colors.green} />
                <Text style={styles.secondaryButtonText}>Try a demo chat</Text>
              </>
            )}
          </Pressable>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
        </View>
      ) : (
        <FlatList
          testID="contacts-list"
          data={contacts}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadData();
              }}
              tintColor={colors.green}
            />
          }
        />
      )}

      <Pressable
        testID="import-fab"
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push("/import")}
      >
        <Ionicons name="add" size={28} color="#052E24" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerWrap: {
    backgroundColor: colors.header,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { color: colors.text, fontSize: 24, fontWeight: "700" },
  brandSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerIcon: { padding: 6 },
  awayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.elevated,
    borderRadius: radius.pill,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 2,
  },
  awayLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  awayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  awayBannerText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: spacing.lg,
    minHeight: 48,
  },
  primaryButtonText: { color: "#052E24", fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.green,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: spacing.sm,
    minHeight: 44,
  },
  secondaryButtonText: { color: colors.green, fontSize: 14, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 12, marginTop: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: colors.surface },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#052E24", fontSize: 20, fontWeight: "700" },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowName: { color: colors.text, fontSize: 16, fontWeight: "600", flex: 1 },
  rowTime: { color: colors.textSecondary, fontSize: 11, marginLeft: 8 },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    gap: 8,
  },
  rowPreview: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  agentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  agentBadgeOff: { backgroundColor: colors.elevated },
  agentBadgeText: { color: "#052E24", fontSize: 10, fontWeight: "700" },
  agentBadgeTextOff: { color: colors.textSecondary },
  infoButton: { marginLeft: 8, padding: 4 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
