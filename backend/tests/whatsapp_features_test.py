"""
New feature tests for iteration 2:
- WhatsApp Business Cloud API config + webhook verify/receive
- Per-contact custom_instructions and wa_number (normalization, exclude_unset)
- Auto-reply history logs
- Simulator auto-reply respects custom_instructions
"""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

DEMO_ID = "0147c616-625a-426a-b0a6-4abd87f3690f"


@pytest.fixture(scope="session")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- WhatsApp config -----
class TestWhatsAppConfig:
    def test_get_config_shape_and_stability(self, sess):
        r = sess.get(f"{API}/whatsapp/config", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["connected"] is False
        assert data["webhook_path"] == "/api/whatsapp/webhook"
        assert isinstance(data["verify_token"], str) and len(data["verify_token"]) >= 10
        # Verify token stable across calls
        r2 = sess.get(f"{API}/whatsapp/config", timeout=30)
        assert r2.json()["verify_token"] == data["verify_token"]

    def test_post_config_fake_creds_returns_400(self, sess):
        r = sess.post(
            f"{API}/whatsapp/config",
            json={"access_token": "EAAG_FAKE_TOKEN_1234567890", "phone_number_id": "1234567890"},
            timeout=30,
        )
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "Meta" in detail or "credentials" in detail.lower()


# ----- Webhook verify -----
class TestWebhookVerify:
    def test_correct_verify_token_echoes_challenge(self, sess):
        cfg = sess.get(f"{API}/whatsapp/config", timeout=30).json()
        r = sess.get(
            f"{API}/whatsapp/webhook",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": cfg["verify_token"],
                "hub.challenge": "CHALLENGE123",
            },
            timeout=30,
        )
        assert r.status_code == 200
        assert r.text == "CHALLENGE123"

    def test_wrong_verify_token_403(self, sess):
        r = sess.get(
            f"{API}/whatsapp/webhook",
            params={"hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "X"},
            timeout=30,
        )
        assert r.status_code == 403


# ----- Webhook receive: unknown number -----
class TestWebhookReceive:
    def test_unknown_number_returns_ok_and_logs_skipped(self, sess):
        marker = f"TEST_unknown_{int(time.time())}"
        payload = {
            "entry": [{
                "changes": [{
                    "value": {
                        "messages": [{
                            "from": "10000000000",
                            "type": "text",
                            "text": {"body": marker},
                        }]
                    }
                }]
            }]
        }
        r = sess.post(f"{API}/whatsapp/webhook", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
        # Verify log entry
        time.sleep(0.5)
        logs = sess.get(f"{API}/logs", timeout=30).json()
        matched = [l for l in logs if l.get("incoming_text") == marker]
        assert matched, "Expected log entry for unknown-number message"
        entry = matched[0]
        assert entry["status"] == "skipped"
        assert entry["source"] == "whatsapp"
        assert "unknown" in (entry.get("reason") or "").lower()


# ----- PATCH contact: custom_instructions + wa_number normalization + exclude_unset -----
class TestContactPatch:
    def _get_demo(self, sess):
        r = sess.get(f"{API}/contacts/{DEMO_ID}", timeout=30)
        if r.status_code == 404:
            # Recreate demo
            sess.post(f"{API}/demo", timeout=120)
            r = sess.get(f"{API}/contacts/{DEMO_ID}", timeout=30)
        assert r.status_code == 200
        return r.json()

    def test_wa_number_normalization_and_clear(self, sess):
        self._get_demo(sess)
        r = sess.patch(f"{API}/contacts/{DEMO_ID}",
                       json={"wa_number": "+91 98765 43210"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["wa_number"] == "919876543210"
        # Empty string clears to null
        r2 = sess.patch(f"{API}/contacts/{DEMO_ID}", json={"wa_number": ""}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["wa_number"] is None
        # Restore for downstream tests
        r3 = sess.patch(f"{API}/contacts/{DEMO_ID}",
                        json={"wa_number": "919876543210"}, timeout=30)
        assert r3.json()["wa_number"] == "919876543210"

    def test_custom_instructions_length_validation(self, sess):
        r = sess.patch(f"{API}/contacts/{DEMO_ID}",
                       json={"custom_instructions": "x" * 2001}, timeout=30)
        assert r.status_code == 422

    def test_exclude_unset_preserves_custom_instructions(self, sess):
        # Set custom_instructions
        sess.patch(f"{API}/contacts/{DEMO_ID}",
                   json={"custom_instructions": "TEST_marker_do_not_wipe"}, timeout=30)
        # PATCH with only auto_reply_enabled should NOT wipe custom_instructions
        r = sess.patch(f"{API}/contacts/{DEMO_ID}",
                       json={"auto_reply_enabled": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["custom_instructions"] == "TEST_marker_do_not_wipe"
        # Cleanup - clear
        sess.patch(f"{API}/contacts/{DEMO_ID}",
                   json={"custom_instructions": ""}, timeout=30)


# ----- Logs -----
class TestLogs:
    def test_logs_sorted_desc(self, sess):
        logs = sess.get(f"{API}/logs", timeout=30).json()
        assert isinstance(logs, list)
        if len(logs) >= 2:
            assert logs[0]["created_at"] >= logs[1]["created_at"]

    def test_logs_include_whatsapp_skipped(self, sess):
        logs = sess.get(f"{API}/logs", timeout=30).json()
        wa_skipped = [l for l in logs if l["source"] == "whatsapp" and l["status"] == "skipped"]
        assert wa_skipped, "Expected at least one whatsapp/skipped log from prior tests"


# ----- Simulator auto-reply honors custom_instructions -----
class TestCustomInstructionsInAutoReply:
    def test_custom_instructions_respected(self, sess):
        # Ensure demo exists
        sess.post(f"{API}/demo", timeout=120)
        # Set a strong custom instruction
        sess.patch(f"{API}/contacts/{DEMO_ID}", json={
            "custom_instructions": "Never commit to any plans. Always say you will confirm tomorrow.",
            "auto_reply_enabled": True,
        }, timeout=30)
        # Send an incoming message as contact
        sess.post(f"{API}/contacts/{DEMO_ID}/messages",
                  json={"sender": "contact", "text": "movie chale kal pakka?"}, timeout=30)
        # Trigger auto-reply
        r = sess.post(f"{API}/contacts/{DEMO_ID}/auto-reply", timeout=120)
        assert r.status_code == 200, r.text
        reply = r.json()["text"].lower()
        # Should NOT commit ("pakka"/"done"/"haan pakka") and should defer
        # Loose check: contains deferral hint like "kal", "confirm", "bata", "batata", "dekh"
        assert any(k in reply for k in ["kal", "confirm", "bata", "dekh", "sure", "abhi", "later"]), \
            f"Reply did not defer: {reply}"
        # Cleanup
        sess.patch(f"{API}/contacts/{DEMO_ID}",
                   json={"custom_instructions": ""}, timeout=30)
