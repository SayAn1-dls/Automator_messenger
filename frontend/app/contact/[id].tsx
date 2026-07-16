import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Contact } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

const DELAY_OPTIONS = [
  { label: "5s", value: 5 },
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
];

export default function ContactProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api<Contact>(`/contacts/${id}`);
      setContact(c);
      setInstructions(c.custom_instructions || "");
      setWaNumber(c.wa_number || "");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load contact");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSettings = async (
    updates: Partial<Pick<Contact, "auto_reply_enabled" | "auto_reply_delay_seconds">>,
  ) => {
    if (!contact) return;
    const prev = contact;
    setContact({ ...contact, ...updates });
    try {
      const updated = await api<Contact>(`/contacts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      setContact(updated);
    } catch {
      setContact(prev);
    }
  };

  const rulesDirty =
    !!contact &&
    (instructions !== (contact.custom_instructions || "") ||
      waNumber !== (contact.wa_number || ""));

  const saveRules = async () => {
    if (!contact) return;
    setSavingRules(true);
    setErrorMsg(null);
    try {
      const updated = await api<Contact>(`/contacts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          custom_instructions: instructions,
          wa_number: waNumber,
        }),
      });
      setContact(updated);
      setInstructions(updated.custom_instructions || "");
      setWaNumber(updated.wa_number || "");
      setRulesSaved(true);
      setTimeout(() => setRulesSaved(false), 2500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to save rules");
    } finally {
      setSavingRules(false);
    }
  };

  const reanalyze = async () => {
    setReanalyzing(true);
    setErrorMsg(null);
    try {
      const updated = await api<Contact>(`/contacts/${id}/reanalyze`, {
        method: "POST",
      });
      setContact(updated);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Re-analysis failed");
    } finally {
      setReanalyzing(false);
    }
  };

  const deleteContact = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    try {
      await api(`/contacts/${id}`, { method: "DELETE" });
      router.dismissAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const profile = contact?.style_profile;

  return (
    <View style={styles.container} testID="contact-profile-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          testID="profile-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{ padding: 4 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Agent settings</Text>
      </View>

      {!contact ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{
            padding: spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <View style={styles.profileTop}>
            <View style={styles.bigAvatar}>
              <Text style={styles.bigAvatarText}>
                {contact.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.contactName} testID="profile-contact-name">
              {contact.name}
            </Text>
            <Text style={styles.contactMeta}>
              {contact.message_count.toLocaleString()} messages learned · you
              are {contact.my_name}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Auto-reply agent</Text>
                <Text style={styles.settingSub}>
                  Reply for you when you&apos;re away
                </Text>
              </View>
              <Switch
                testID="auto-reply-switch"
                value={contact.auto_reply_enabled}
                onValueChange={(v) => updateSettings({ auto_reply_enabled: v })}
                trackColor={{ false: "#374248", true: colors.greenDark }}
                thumbColor={contact.auto_reply_enabled ? colors.green : "#8696A0"}
              />
            </View>

            <View style={styles.divider} />

            <Text style={styles.settingLabel}>Reply delay</Text>
            <Text style={styles.settingSub}>
              Agent waits this long for you before replying
            </Text>
            <View style={styles.chipRowWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRowContent}
              >
                {DELAY_OPTIONS.map((opt) => {
                  const selected =
                    contact.auto_reply_delay_seconds === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      testID={`delay-chip-${opt.value}`}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() =>
                        updateSettings({ auto_reply_delay_seconds: opt.value })
                      }
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Agent rules</Text>
          <View style={styles.card} testID="agent-rules-card">
            <Text style={styles.settingLabel}>Custom instructions</Text>
            <Text style={styles.settingSub}>
              Extra rules the agent must follow in this chat
            </Text>
            <TextInput
              testID="custom-instructions-input"
              style={styles.instructionsInput}
              multiline
              value={instructions}
              onChangeText={setInstructions}
              placeholder={
                "e.g. Never commit to plans — say I'll confirm later. Don't share where I am."
              }
              placeholderTextColor={colors.textSecondary}
              textAlignVertical="top"
            />
            <View style={styles.divider} />
            <Text style={styles.settingLabel}>Linked WhatsApp number</Text>
            <Text style={styles.settingSub}>
              Live WhatsApp messages from this number get auto-replies (include
              country code, digits only)
            </Text>
            <TextInput
              testID="wa-number-input"
              style={styles.waInput}
              value={waNumber}
              onChangeText={setWaNumber}
              placeholder="e.g. 919876543210"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
            />
            <Pressable
              testID="save-agent-rules-button"
              style={[
                styles.saveButton,
                !rulesDirty && !rulesSaved && styles.saveButtonDisabled,
              ]}
              onPress={saveRules}
              disabled={!rulesDirty || savingRules}
            >
              {savingRules ? (
                <ActivityIndicator color="#052E24" size="small" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {rulesSaved ? "Saved ✓" : "Save rules"}
                </Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Learned style</Text>
          {contact.analysis_status === "analyzing" || reanalyzing ? (
            <View style={[styles.card, styles.analyzeCard]} testID="style-analyzing">
              <ActivityIndicator color={colors.green} />
              <Text style={styles.analyzeText}>Analyzing your texting style…</Text>
            </View>
          ) : profile ? (
            <View style={styles.card} testID="style-profile-card">
              <View style={styles.summaryRow}>
                <MaterialCommunityIcons name="robot-happy" size={18} color={colors.green} />
                <Text style={styles.summaryText}>{profile.style_summary}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.traitGrid}>
                <Trait icon="language" label="Language" value={(profile.languages || []).join(", ") || "—"} />
                <Trait icon="musical-notes" label="Tone" value={profile.tone || "—"} />
                <Trait icon="shirt" label="Formality" value={profile.formality || "—"} />
                <Trait icon="happy" label="Emojis" value={profile.emoji_usage || "—"} />
                <Trait icon="resize" label="Length" value={profile.avg_message_length || "—"} />
                <Trait icon="people" label="Relationship" value={profile.relationship || "—"} />
              </View>
              {profile.common_phrases && profile.common_phrases.length > 0 && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.settingSub}>Phrases you actually use</Text>
                  <View style={styles.chipRowWrap}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chipRowContent}
                    >
                      {profile.common_phrases.map((phrase, i) => (
                        <View key={i} style={[styles.chip, styles.phraseChip]}>
                          <Text style={styles.phraseChipText}>{phrase}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}
              {profile.quirks ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.settingSub}>Quirks</Text>
                  <Text style={styles.quirksText}>{profile.quirks}</Text>
                </>
              ) : null}
            </View>
          ) : (
            <View style={[styles.card, styles.analyzeCard]} testID="style-failed">
              <Ionicons name="warning-outline" size={18} color={colors.amber} />
              <Text style={styles.analyzeText}>
                Style analysis didn&apos;t finish. The agent still uses your real
                messages as examples.
              </Text>
            </View>
          )}

          <Pressable
            testID="reanalyze-button"
            style={styles.outlineButton}
            onPress={reanalyze}
            disabled={reanalyzing}
          >
            <Ionicons name="refresh" size={16} color={colors.green} />
            <Text style={styles.outlineButtonText}>Re-analyze style</Text>
          </Pressable>

          <Pressable
            testID="delete-contact-button"
            style={[styles.outlineButton, styles.deleteButton]}
            onPress={deleteContact}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={[styles.outlineButtonText, { color: colors.danger }]}>
              {confirmDelete ? "Tap again to confirm delete" : "Delete chat & profile"}
            </Text>
          </Pressable>

          {errorMsg ? (
            <Text style={styles.errorText} testID="profile-error-text">
              {errorMsg}
            </Text>
          ) : null}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function Trait({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.trait}>
      <View style={styles.traitLabelRow}>
        <Ionicons name={icon} size={12} color={colors.textSecondary} />
        <Text style={styles.traitLabel}>{label}</Text>
      </View>
      <Text style={styles.traitValue} numberOfLines={2}>
        {value}
      </Text>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  profileTop: { alignItems: "center", marginBottom: spacing.md },
  bigAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  bigAvatarText: { color: "#052E24", fontSize: 34, fontWeight: "700" },
  contactName: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing.sm },
  contactMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  settingSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  chipRowWrap: { height: 56, justifyContent: "center", marginTop: spacing.xs },
  chipRowContent: {
    gap: 8,
    alignItems: "center",
    paddingRight: spacing.md,
  },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipSelected: { backgroundColor: colors.green },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextSelected: { color: "#052E24" },
  phraseChip: { backgroundColor: colors.greenSoft },
  phraseChipText: { color: colors.green, fontSize: 13, fontWeight: "600" },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  analyzeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  analyzeText: { color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 19 },
  summaryRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  summaryText: { color: colors.text, fontSize: 14, lineHeight: 21, flex: 1 },
  traitGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.md,
  },
  trait: { width: "50%", paddingRight: spacing.sm },
  traitLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  traitLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  traitValue: { color: colors.text, fontSize: 13, marginTop: 3, lineHeight: 18 },
  quirksText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  instructionsInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    padding: 12,
    minHeight: 90,
    marginTop: spacing.sm,
  },
  waInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    marginTop: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: spacing.md,
    minHeight: 44,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: "#052E24", fontSize: 14, fontWeight: "700" },
  outlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  outlineButtonText: { color: colors.green, fontSize: 14, fontWeight: "600" },
  deleteButton: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
