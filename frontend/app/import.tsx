import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Contact, Participant } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

type Step = "input" | "pick" | "analyzing";

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [chatText, setChatText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [myName, setMyName] = useState<string | null>(null);
  const [contactName, setContactName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pickFile = async () => {
    setErrorMsg(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/plain", "text/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      let content: string;
      if (Platform.OS === "web") {
        const res = await fetch(asset.uri);
        content = await res.text();
      } else {
        content = await FileSystem.readAsStringAsync(asset.uri);
      }
      setChatText(content);
      setFileName(asset.name || "chat.txt");
    } catch {
      setErrorMsg("Could not read that file. Try pasting the chat text instead.");
    }
  };

  const runPreview = async () => {
    if (!chatText.trim()) {
      setErrorMsg("Upload or paste your exported chat first.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api<{
        participants: Participant[];
        total_messages: number;
      }>("/import/preview", {
        method: "POST",
        body: JSON.stringify({ chat_text: chatText }),
      });
      setParticipants(res.participants);
      setTotalMessages(res.total_messages);
      setMyName(null);
      setContactName(null);
      setStep("pick");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not parse the chat");
    } finally {
      setLoading(false);
    }
  };

  const selectMe = (name: string) => {
    setMyName(name);
    const others = participants.filter((p) => p.name !== name);
    setContactName(others.length === 1 ? others[0].name : null);
  };

  const confirmImport = async () => {
    if (!myName || !contactName) return;
    setStep("analyzing");
    setErrorMsg(null);
    try {
      const contact = await api<Contact>("/import/confirm", {
        method: "POST",
        body: JSON.stringify({
          chat_text: chatText,
          my_name: myName,
          contact_name: contactName,
        }),
      });
      router.replace(`/contact/${contact.id}`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Import failed");
      setStep("pick");
    }
  };

  return (
    <View style={styles.container} testID="import-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          testID="import-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Import chat</Text>
          <Text style={styles.headerSub}>
            WhatsApp → Chat → More → Export chat → Without media
          </Text>
        </View>
      </View>

      {step === "analyzing" ? (
        <View style={styles.center} testID="analyzing-state">
          <ActivityIndicator size="large" color={colors.green} />
          <Text style={styles.analyzingTitle}>Learning your style…</Text>
          <Text style={styles.analyzingText}>
            Claude is reading how {myName} talks with {contactName} — tone,
            language, emojis, phrases. This takes a few seconds.
          </Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          {step === "input" && (
            <>
              <Pressable
                testID="upload-file-button"
                style={styles.uploadCard}
                onPress={pickFile}
              >
                <Ionicons
                  name={fileName ? "document-text" : "cloud-upload-outline"}
                  size={30}
                  color={colors.green}
                />
                <Text style={styles.uploadTitle}>
                  {fileName ? fileName : "Upload exported .txt file"}
                </Text>
                <Text style={styles.uploadSub}>
                  {fileName
                    ? `${chatText.length.toLocaleString()} characters loaded — tap to change`
                    : "Tap to choose the exported chat file"}
                </Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or paste the chat</Text>
                <View style={styles.dividerLine} />
              </View>

              <TextInput
                testID="chat-text-input"
                style={styles.textArea}
                multiline
                placeholder={
                  "12/03/25, 9:14 pm - Rahul: Bro kal match dekha??\n12/03/25, 9:16 pm - You: haan bhai 🔥"
                }
                placeholderTextColor={colors.textSecondary}
                value={fileName ? "" : chatText}
                onChangeText={(t) => {
                  setChatText(t);
                  setFileName(null);
                }}
                textAlignVertical="top"
              />

              <Pressable
                testID="import-continue-button"
                style={[
                  styles.primaryButton,
                  !chatText.trim() && styles.buttonDisabled,
                ]}
                onPress={runPreview}
                disabled={loading || !chatText.trim()}
              >
                {loading ? (
                  <ActivityIndicator color="#052E24" size="small" />
                ) : (
                  <>
                    <Text style={styles.primaryButtonText}>Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="#052E24" />
                  </>
                )}
              </Pressable>
            </>
          )}

          {step === "pick" && (
            <>
              <View style={styles.parsedBanner} testID="parsed-banner">
                <Ionicons name="checkmark-circle" size={18} color={colors.green} />
                <Text style={styles.parsedText}>
                  Parsed {totalMessages.toLocaleString()} messages from{" "}
                  {participants.length} participants
                </Text>
              </View>

              <Text style={styles.sectionLabel}>Which one is you?</Text>
              {participants.map((p) => (
                <Pressable
                  key={`me-${p.name}`}
                  testID={`pick-me-${p.name}`}
                  style={[
                    styles.participantCard,
                    myName === p.name && styles.participantCardActive,
                  ]}
                  onPress={() => selectMe(p.name)}
                >
                  <View style={styles.participantAvatar}>
                    <Text style={styles.participantAvatarText}>
                      {p.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    <Text style={styles.participantCount}>
                      {p.message_count} messages
                    </Text>
                  </View>
                  <Ionicons
                    name={
                      myName === p.name
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    size={22}
                    color={myName === p.name ? colors.green : colors.textSecondary}
                  />
                </Pressable>
              ))}

              {myName && participants.length > 2 && (
                <>
                  <Text style={styles.sectionLabel}>
                    Who should the agent reply to?
                  </Text>
                  {participants
                    .filter((p) => p.name !== myName)
                    .map((p) => (
                      <Pressable
                        key={`contact-${p.name}`}
                        testID={`pick-contact-${p.name}`}
                        style={[
                          styles.participantCard,
                          contactName === p.name && styles.participantCardActive,
                        ]}
                        onPress={() => setContactName(p.name)}
                      >
                        <View style={styles.participantAvatar}>
                          <Text style={styles.participantAvatarText}>
                            {p.name.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.participantName}>{p.name}</Text>
                          <Text style={styles.participantCount}>
                            {p.message_count} messages
                          </Text>
                        </View>
                        <Ionicons
                          name={
                            contactName === p.name
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={22}
                          color={
                            contactName === p.name
                              ? colors.green
                              : colors.textSecondary
                          }
                        />
                      </Pressable>
                    ))}
                </>
              )}

              {myName && contactName && (
                <View style={styles.summaryCard} testID="import-summary">
                  <Ionicons name="sparkles" size={16} color={colors.amber} />
                  <Text style={styles.summaryText}>
                    The agent will learn how{" "}
                    <Text style={styles.summaryBold}>{myName}</Text> talks with{" "}
                    <Text style={styles.summaryBold}>{contactName}</Text> and
                    reply in that exact style.
                  </Text>
                </View>
              )}

              <Pressable
                testID="import-confirm-button"
                style={[
                  styles.primaryButton,
                  (!myName || !contactName) && styles.buttonDisabled,
                ]}
                onPress={confirmImport}
                disabled={!myName || !contactName}
              >
                <Ionicons name="sparkles-outline" size={18} color="#052E24" />
                <Text style={styles.primaryButtonText}>
                  Import & analyze style
                </Text>
              </Pressable>

              <Pressable
                testID="import-start-over-button"
                style={styles.linkButton}
                onPress={() => setStep("input")}
              >
                <Text style={styles.linkButtonText}>Start over</Text>
              </Pressable>
            </>
          )}

          {errorMsg ? (
            <Text style={styles.errorText} testID="import-error-text">
              {errorMsg}
            </Text>
          ) : null}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.header,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  headerSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  analyzingTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: spacing.md,
  },
  analyzingText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  uploadCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: 6,
  },
  uploadTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  uploadSub: { color: colors.textSecondary, fontSize: 12, textAlign: "center" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: spacing.md,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary, fontSize: 12 },
  textArea: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    padding: spacing.md,
    minHeight: 160,
    maxHeight: 240,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingVertical: 14,
    marginTop: spacing.md,
    minHeight: 48,
  },
  primaryButtonText: { color: "#052E24", fontSize: 15, fontWeight: "700" },
  buttonDisabled: { opacity: 0.4 },
  parsedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  parsedText: { color: colors.text, fontSize: 13, flex: 1 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  participantCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: spacing.sm,
    minHeight: 48,
  },
  participantCardActive: {
    borderColor: colors.green,
    backgroundColor: colors.greenSoft,
  },
  participantAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  participantAvatarText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  participantName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  participantCount: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  summaryCard: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 12,
    marginTop: spacing.sm,
    alignItems: "flex-start",
  },
  summaryText: { color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 19 },
  summaryBold: { color: colors.text, fontWeight: "700" },
  linkButton: { alignItems: "center", padding: spacing.md, minHeight: 44 },
  linkButtonText: { color: colors.textSecondary, fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.md, textAlign: "center" },
});
