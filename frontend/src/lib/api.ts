const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export const BACKEND_URL = BASE_URL;

export interface StyleProfile {
  languages?: string[];
  tone?: string;
  formality?: string;
  emoji_usage?: string;
  avg_message_length?: string;
  common_phrases?: string[];
  greeting_style?: string;
  quirks?: string;
  relationship?: string;
  style_summary?: string;
}

export interface Contact {
  id: string;
  name: string;
  export_contact_name: string;
  my_name: string;
  message_count: number;
  style_profile: StyleProfile | null;
  analysis_status: "analyzing" | "done" | "failed";
  auto_reply_enabled: boolean;
  auto_reply_delay_seconds: number;
  custom_instructions?: string;
  wa_number?: string | null;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface WaConfig {
  connected: boolean;
  phone_number_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  verify_token: string;
  access_token_masked: string | null;
  webhook_path: string;
}

export interface ReplyLog {
  id: string;
  source: "simulator" | "whatsapp";
  status: "sent" | "skipped" | "failed";
  incoming_text: string;
  reply_text: string | null;
  contact_id: string | null;
  contact_name: string | null;
  reason: string | null;
  created_at: string;
}

export interface SimMessage {
  id: string;
  contact_id: string;
  sender: "contact" | "me" | "agent";
  text: string;
  replied: boolean;
  created_at: string;
}

export interface Participant {
  name: string;
  message_count: number;
}

export async function api<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // keep default detail
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
