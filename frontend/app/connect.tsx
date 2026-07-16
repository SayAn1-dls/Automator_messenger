import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BACKEND_URL, WaConfig } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme";

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [config, setConfig] = useState<WaConfig | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfig(await api<WaConfig>("/whatsapp/config"));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load config");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const webhookUrl = config ? `${BACKEND_URL}${config.webhook_path}` : "";

  const copy = async (value: string, key: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const connect = async () => {
    if (!accessToken.trim() || !phoneNumberId.trim()) return;
    setConnecting(true);
    setErrorMsg(null);
    try {
      const updated = await api<WaConfig>("/whatsapp/config", {
        method: "POST",
        body: JSON.stringify({
          access_token: accessToken.trim(),
          phone_number_id: phoneNumberId.trim(),
        }),
      });
      setConfig(updated);
      setAccessToken("");
      setPhoneNumberId("");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      setTimeout(() => setConfirmDisconnect(false), 3000);
      return;
    }
    try {
      setConfig(await api<WaConfig>("/whatsapp/config", { method: "DELETE" }));
      setConfirmDisconnect(false);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  return (
    <View style={styles.container} testID="connect-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          testID="connect-back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{ padding: 4 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Connect WhatsApp</Text>
      </View>

      {!config ? (
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
          <View
            style={[
              styles.statusCard,
              config.connected && { borderColor: colors.green },
            ]}
            testID="connection-status-card"
          >
            <Ionicons
              name={config.connected ? "checkmark-circle" : "cloud-offline-outline"}
              size={26}
              color={config.connected ? colors.green : colors.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>
                {config.connected ? "Connected" : "Not connected"}
              </Text>
              <Text style={styles.statusSub}>
                {config.connected
                  ? `${config.verified_name || "Business"} · +${config.display_phone_number || config.phone_number_id} · token ${config.access_token_masked}`
                  : "Live auto-replies start once your Meta Business number is linked"}
              </Text>
            </View>
          </View>

          <View style={styles.noteCard}>
            <Ionicons name="information-circle" size={16} color={colors.amber} />
            <Text style={styles.noteText}>
              Requires a Meta WhatsApp Business Cloud API app (free at
              developers.facebook.com). Personal WhatsApp numbers can&apos;t be
              automated by Meta&apos;s rules — the simulator keeps working
              either way.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Step 1 — Webhook setup in Meta</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Callback URL</Text>
            <Pressable
              testID="copy-webhook-url"
              style={styles.copyRow}
              onPress={() => copy(webhookUrl, "url")}
            >
              <Text style={styles.copyValue} numberOfLines={1}>
                {webhookUrl}
              </Text>
              <Ionicons
                name={copied === "url" ? "checkmark" : "copy-outline"}
                size={18}
                color={copied === "url" ? colors.green : colors.textSecondary}
              />
            </Pressable>

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
              Verify token
            </Text>
            <Pressable
              testID="copy-verify-token"
              style={styles.copyRow}
              onPress={() => copy(config.verify_token, "token")}
            >
              <Text style={styles.copyValue} numberOfLines={1}>
                {config.verify_token}
              </Text>
              <Ionicons
                name={copied === "token" ? "checkmark" : "copy-outline"}
                size={18}
                color={copied === "token" ? colors.green : colors.textSecondary}
              />
            </Pressable>
            <Text style={styles.hintText}>
              Meta App Dashboard → WhatsApp → Configuration → Webhooks: paste
              both, then subscribe to the &quot;messages&quot; field.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Step 2 — API credentials</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Access token</Text>
            <TextInput
              testID="access-token-input"
              style={styles.input}
              value={accessToken}
              onChangeText={setAccessToken}
              placeholder="EAAG… (WhatsApp → API Setup → Generate token)"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
              Phone number ID
            </Text>
            <TextInput
              testID="phone-number-id-input"
              style={styles.input}
              value={phoneNumberId}
              onChangeText={setPhoneNumberId}
              placeholder="e.g. 106540352242922"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
            />
            <Pressable
              testID="connect-button-submit"
              style={[
                styles.primaryButton,
                (!accessToken.trim() || !phoneNumberId.trim()) &&
                  styles.buttonDisabled,
              ]}
              onPress={connect}
              disabled={connecting || !accessToken.trim() || !phoneNumberId.trim()}
            >
              {connecting ? (
                <ActivityIndicator color="#052E24" size="small" />
              ) : (
                <>
                  <Ionicons name="link" size={18} color="#052E24" />
                  <Text style={styles.primaryButtonText}>
                    {config.connected ? "Update credentials" : "Verify & connect"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Step 3 — Link your contacts</Text>
          <View style={styles.card}>
            <Text style={styles.hintText}>
              Open a contact&apos;s agent settings and add their WhatsApp number
              (with country code). Only linked numbers get live auto-replies —
              unknown numbers are ignored and logged.
            </Text>
          </View>

          {config.connected && (
            <Pressable
              testID="disconnect-button"
              style={styles.disconnectButton}
              onPress={disconnect}
            >
              <Ionicons name="unlink" size={16} color={colors.danger} />
              <Text style={styles.disconnectText}>
                {confirmDisconnect ? "Tap again to confirm" : "Disconnect"}
              </Text>
            </Pressable>
          )}

          {errorMsg ? (
            <Text style={styles.errorText} testID="connect-error-text">
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
    gap: 12,
    backgroundColor: colors.header,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statusTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  statusSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  noteCard: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 12,
    marginTop: spacing.sm,
    alignItems: "flex-start",
  },
  noteText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
  },
  copyValue: { color: colors.green, fontSize: 12, flex: 1 },
  hintText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingVertical: 13,
    marginTop: spacing.md,
    minHeight: 48,
  },
  primaryButtonText: { color: "#052E24", fontSize: 15, fontWeight: "700" },
  buttonDisabled: { opacity: 0.4 },
  disconnectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginTop: spacing.lg,
    minHeight: 44,
  },
  disconnectText: { color: colors.danger, fontSize: 14, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 13, textAlign: "center", marginTop: spacing.md },
});
