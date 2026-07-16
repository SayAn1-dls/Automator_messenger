import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Contact, SimMessage } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [awayMode, setAwayMode] = useState(true);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [input, setInput] = useState("");
  const [sendAs, setSendAs] = useState<"contact" | "me">("contact");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [fireAt, setFireAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const firingRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [c, msgs, settings] = await Promise.all([
        api<Contact>(`/contacts/${id}`),
        api<SimMessage[]>(`/contacts/${id}/messages`),
        api<{ away_mode: boolean }>("/settings"),
      ]);
      setContact(c);
      setMessages(msgs);
      setAwayMode(settings.away_mode);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load chat");
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const fireAutoReply = useCallback(async () => {
    if (firingRef.current) return;
    firingRef.current = true;
    setFireAt(null);
    setGenerating(true);
    try {
      const agentMsg = await api<SimMessage>(`/contacts/${id}/auto-reply`, {
        method: "POST",
      });
      setMessages((prev) => [...prev, agentMsg]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Auto-reply failed");
    } finally {
      setGenerating(false);
      firingRef.current = false;
    }
  }, [id]);

  // Countdown ticker
  useEffect(() => {
    if (fireAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((fireAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) fireAutoReply();
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [fireAt, fireAutoReply]);

  const cancelPending = async () => {
    setFireAt(null);
    try {
      await api(`/contacts/${id}/cancel-pending`, { method: "POST" });
    } catch {
      // non-blocking
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending || !contact) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const msg = await api<SimMessage>(`/contacts/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, sender: sendAs }),
      });
      setMessages((prev) => [...prev, msg]);
      setInput("");
      if (sendAs === "contact") {
        if (awayMode && contact.auto_reply_enabled && !generating) {
          setFireAt(Date.now() + contact.auto_reply_delay_seconds * 1000);
        }
      } else {
        setFireAt(null);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const renderMessage = ({ item }: { item: SimMessage }) => {
    const isIncoming = item.sender === "contact";
    const isAgent = item.sender === "agent";
    return (
      <View
        testID={`message-bubble-${item.id}`}
        style={[
          styles.bubble,
          isIncoming ? styles.bubbleIn : styles.bubbleOut,
        ]}
      >
        {isAgent && (
          <View style={styles.agentTag}>
            <MaterialCommunityIcons name="robot" size={11} color={colors.amber} />
            <Text style={styles.agentTagText}>AI Agent · as {contact?.my_name}</Text>
          </View>
        )}
        <Text style={styles.bubbleText}>{item.text}</Text>
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>
            {dayjs(item.created_at).format("h:mm A")}
          </Text>
          {!isIncoming && (
            <Ionicons name="checkmark-done" size={14} color="#53BDEB" />
          )}
        </View>
      </View>
    );
  };

  const agentActive = awayMode && (contact?.auto_reply_enabled ?? false);

  return (
    <View style={styles.container} testID="chat-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          testID="chat-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{ padding: 4 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          testID="chat-header-profile"
          style={styles.headerCenter}
          onPress={() => router.push(`/contact/${id}`)}
        >
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>
              {contact?.name.slice(0, 1).toUpperCase() || "?"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>
              {contact?.name || "…"}
            </Text>
            <Text
              style={[styles.headerStatus, agentActive && { color: colors.green }]}
              numberOfLines={1}
              testID="agent-status-text"
            >
              {generating
                ? "agent typing…"
                : agentActive
                  ? `agent on · replies in ${contact?.auto_reply_delay_seconds}s`
                  : awayMode
                    ? "agent off for this chat"
                    : "away mode off"}
            </Text>
          </View>
        </Pressable>
        <Pressable
          testID="chat-settings-button"
          onPress={() => router.push(`/contact/${id}`)}
          hitSlop={12}
          style={{ padding: 4 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="translate-with-padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          testID="messages-list"
          data={inverted}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingTop: spacing.md,
            paddingBottom: spacing.sm,
          }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyChat} testID="empty-chat-hint">
              <View style={styles.simulatorCard}>
                <Ionicons name="flask-outline" size={22} color={colors.amber} />
                <Text style={styles.simulatorTitle}>Chat simulator</Text>
                <Text style={styles.simulatorText}>
                  Send a message as {contact?.name || "your contact"} below. If
                  you don&apos;t reply within{" "}
                  {contact?.auto_reply_delay_seconds ?? 15}s, your AI agent
                  replies exactly like {contact?.my_name || "you"} would.
                </Text>
              </View>
            </View>
          }
        />

        {generating && (
          <View style={styles.typingRow} testID="typing-indicator">
            <View style={styles.typingBubble}>
              <MaterialCommunityIcons name="robot" size={14} color={colors.amber} />
              <ActivityIndicator size="small" color={colors.green} />
              <Text style={styles.typingText}>agent is typing…</Text>
            </View>
          </View>
        )}

        {fireAt !== null && !generating && (
          <View style={styles.countdownRow} testID="countdown-banner">
            <View style={styles.countdownPill}>
              <MaterialCommunityIcons name="timer-sand" size={14} color="#052E24" />
              <Text style={styles.countdownText}>
                Agent replies in {secondsLeft}s
              </Text>
              <Pressable
                testID="cancel-auto-reply-button"
                onPress={cancelPending}
                hitSlop={8}
                style={styles.countdownCancel}
              >
                <Text style={styles.countdownCancelText}>I&apos;m here</Text>
              </Pressable>
            </View>
          </View>
        )}

        {errorMsg ? (
          <View style={styles.errorRow}>
            <Text style={styles.errorText} testID="chat-error-text">
              {errorMsg}
            </Text>
          </View>
        ) : null}

        <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.senderToggle}>
            <Pressable
              testID="send-as-contact-toggle"
              style={[
                styles.senderChip,
                sendAs === "contact" && styles.senderChipActive,
              ]}
              onPress={() => setSendAs("contact")}
            >
              <Ionicons
                name="person-outline"
                size={13}
                color={sendAs === "contact" ? "#052E24" : colors.textSecondary}
              />
              <Text
                style={[
                  styles.senderChipText,
                  sendAs === "contact" && styles.senderChipTextActive,
                ]}
                numberOfLines={1}
              >
                As {contact?.name?.split(" ")[0] || "them"}
              </Text>
            </Pressable>
            <Pressable
              testID="send-as-me-toggle"
              style={[styles.senderChip, sendAs === "me" && styles.senderChipActive]}
              onPress={() => setSendAs("me")}
            >
              <Ionicons
                name="person"
                size={13}
                color={sendAs === "me" ? "#052E24" : colors.textSecondary}
              />
              <Text
                style={[
                  styles.senderChipText,
                  sendAs === "me" && styles.senderChipTextActive,
                ]}
              >
                As you
              </Text>
            </Pressable>
          </View>
          <View style={styles.composerRow}>
            <TextInput
              testID="message-input"
              style={styles.input}
              placeholder={
                sendAs === "contact"
                  ? `Message as ${contact?.name?.split(" ")[0] || "them"}…`
                  : "Reply as yourself…"
              }
              placeholderTextColor={colors.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
            />
            <Pressable
              testID="send-message-button"
              style={[styles.sendButton, (!input.trim() || sending) && { opacity: 0.5 }]}
              onPress={sendMessage}
              disabled={!input.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#052E24" />
              ) : (
                <Ionicons name="send" size={19} color="#052E24" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.header,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCenter: { flexDirection: "row", alignItems: "center", flex: 1, gap: 10 },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { color: "#052E24", fontSize: 16, fontWeight: "700" },
  headerName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  headerStatus: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  bubble: {
    maxWidth: "80%",
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  bubbleIn: { alignSelf: "flex-start", backgroundColor: colors.bubbleIn },
  bubbleOut: { alignSelf: "flex-end", backgroundColor: colors.bubbleOut },
  agentTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  agentTagText: { color: colors.amber, fontSize: 10, fontWeight: "700" },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 2,
  },
  bubbleTime: { color: "rgba(233,237,239,0.55)", fontSize: 10 },
  emptyChat: { flex: 1, justifyContent: "center", transform: [{ scaleY: -1 }] },
  simulatorCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    padding: spacing.lg,
    gap: 6,
    marginVertical: spacing.lg,
  },
  simulatorTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  simulatorText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  typingRow: { paddingHorizontal: spacing.md, paddingBottom: 6 },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-end",
    backgroundColor: colors.bubbleOut,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typingText: { color: colors.textSecondary, fontSize: 12 },
  countdownRow: { paddingHorizontal: spacing.md, paddingBottom: 6 },
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  countdownText: { color: "#052E24", fontSize: 12, fontWeight: "700" },
  countdownCancel: {
    backgroundColor: "#052E24",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countdownCancelText: { color: colors.amber, fontSize: 11, fontWeight: "700" },
  errorRow: { paddingHorizontal: spacing.md, paddingBottom: 4 },
  errorText: { color: colors.danger, fontSize: 12, textAlign: "center" },
  composerWrap: {
    backgroundColor: colors.header,
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  senderToggle: { flexDirection: "row", gap: 8, marginBottom: 6 },
  senderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.elevated,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 30,
    flexShrink: 0,
  },
  senderChipActive: { backgroundColor: colors.green },
  senderChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  senderChipTextActive: { color: "#052E24" },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.elevated,
    borderRadius: radius.lg,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 110,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
});
