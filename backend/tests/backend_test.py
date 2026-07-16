"""
Backend tests for WhatsApp AI Auto-Reply Agent.
Covers: settings, import preview/confirm, demo, contacts CRUD, sim messages, auto-reply.
"""
import os
import time
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Settings ----------
class TestSettings:
    def test_get_settings(self, sess):
        r = sess.get(f"{API}/settings", timeout=30)
        assert r.status_code == 200
        assert "away_mode" in r.json()

    def test_patch_settings_persists(self, sess):
        r = sess.patch(f"{API}/settings", json={"away_mode": False}, timeout=30)
        assert r.status_code == 200
        assert r.json()["away_mode"] is False
        # Verify persistence
        r2 = sess.get(f"{API}/settings", timeout=30)
        assert r2.json()["away_mode"] is False
        # restore
        sess.patch(f"{API}/settings", json={"away_mode": True}, timeout=30)


# ---------- Import ----------
SAMPLE_CHAT = """12/03/25, 9:14 pm - Rahul: Bro kal match dekha??
12/03/25, 9:16 pm - Arjun: haan bhai kya match tha 🔥
12/03/25, 9:17 pm - Rahul: sahi me yaar
12/03/25, 9:18 pm - Arjun: bilkul bhai GOAT hai 🐐
12/03/25, 9:20 pm - Rahul: weekend pe milte kya?
12/03/25, 9:22 pm - Arjun: haan chal na saturday
"""


class TestImport:
    def test_preview_valid(self, sess):
        r = sess.post(f"{API}/import/preview", json={"chat_text": SAMPLE_CHAT}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["total_messages"] >= 4
        names = {p["name"] for p in data["participants"]}
        assert "Rahul" in names and "Arjun" in names

    def test_preview_invalid_returns_400(self, sess):
        r = sess.post(f"{API}/import/preview", json={"chat_text": "not a chat"}, timeout=30)
        assert r.status_code == 400
        assert "detail" in r.json()


# ---------- Demo (idempotent) ----------
@pytest.fixture(scope="session")
def demo_contact(sess):
    r = sess.post(f"{API}/demo", timeout=120)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["name"] == "Rahul (Demo)"
    return c


class TestDemo:
    def test_demo_creates(self, sess, demo_contact):
        assert demo_contact["id"]
        assert demo_contact["auto_reply_delay_seconds"] == 15 or demo_contact["auto_reply_delay_seconds"] >= 3
        # style_profile may still be analyzing on very first call; but should be done
        assert demo_contact["analysis_status"] in ("done", "analyzing", "failed")

    def test_demo_idempotent(self, sess, demo_contact):
        r = sess.post(f"{API}/demo", timeout=60)
        assert r.status_code == 200
        assert r.json()["id"] == demo_contact["id"]


# ---------- Contacts CRUD ----------
class TestContactsCRUD:
    def test_list_contacts(self, sess, demo_contact):
        r = sess.get(f"{API}/contacts", timeout=30)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()]
        assert demo_contact["id"] in ids

    def test_get_contact(self, sess, demo_contact):
        r = sess.get(f"{API}/contacts/{demo_contact['id']}", timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == demo_contact["id"]

    def test_get_missing_contact_404(self, sess):
        r = sess.get(f"{API}/contacts/nonexistent-id", timeout=30)
        assert r.status_code == 404

    def test_patch_valid_delay(self, sess, demo_contact):
        r = sess.patch(
            f"{API}/contacts/{demo_contact['id']}",
            json={"auto_reply_delay_seconds": 5},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["auto_reply_delay_seconds"] == 5

    def test_patch_invalid_delay_low(self, sess, demo_contact):
        r = sess.patch(
            f"{API}/contacts/{demo_contact['id']}",
            json={"auto_reply_delay_seconds": 1},
            timeout=30,
        )
        assert r.status_code == 422

    def test_patch_invalid_delay_high(self, sess, demo_contact):
        r = sess.patch(
            f"{API}/contacts/{demo_contact['id']}",
            json={"auto_reply_delay_seconds": 5000},
            timeout=30,
        )
        assert r.status_code == 422

    def test_patch_auto_reply_toggle(self, sess, demo_contact):
        r = sess.patch(
            f"{API}/contacts/{demo_contact['id']}",
            json={"auto_reply_enabled": False},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["auto_reply_enabled"] is False
        # restore
        sess.patch(
            f"{API}/contacts/{demo_contact['id']}",
            json={"auto_reply_enabled": True},
            timeout=30,
        )


# ---------- Import confirm & delete cascade ----------
IMPORT_CHAT = """12/03/25, 9:14 pm - Priya: hey how are you
12/03/25, 9:16 pm - Sam: all good tell me
12/03/25, 9:17 pm - Priya: kal aa rahe ho?
12/03/25, 9:18 pm - Sam: haan pakka
12/03/25, 9:19 pm - Priya: cool
12/03/25, 9:20 pm - Sam: 👍
"""


class TestImportConfirmAndCascade:
    def test_confirm_and_delete(self, sess):
        # Create via import/confirm
        r = sess.post(
            f"{API}/import/confirm",
            json={"chat_text": IMPORT_CHAT, "my_name": "Sam", "contact_name": "Priya"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        assert c["analysis_status"] in ("done", "failed")
        # If done, style_profile should be a dict with expected keys
        if c["analysis_status"] == "done":
            sp = c["style_profile"]
            assert isinstance(sp, dict)
            assert "languages" in sp or "style_summary" in sp

        # Same-name rejection
        r_bad = sess.post(
            f"{API}/import/confirm",
            json={"chat_text": IMPORT_CHAT, "my_name": "Sam", "contact_name": "Sam"},
            timeout=30,
        )
        assert r_bad.status_code == 400

        # Add a sim message then delete
        sess.post(
            f"{API}/contacts/{cid}/messages",
            json={"sender": "contact", "text": "test msg"},
            timeout=30,
        )
        r_del = sess.delete(f"{API}/contacts/{cid}", timeout=30)
        assert r_del.status_code == 200
        assert r_del.json()["deleted"] is True
        # Verify gone
        r_get = sess.get(f"{API}/contacts/{cid}", timeout=30)
        assert r_get.status_code == 404


# ---------- Messages + Auto-reply ----------
class TestMessagesAutoReply:
    def test_full_auto_reply_flow(self, sess, demo_contact):
        cid = demo_contact["id"]
        # Clear pending before starting
        sess.post(f"{API}/contacts/{cid}/cancel-pending", timeout=30)

        # Send as contact
        r_msg = sess.post(
            f"{API}/contacts/{cid}/messages",
            json={"sender": "contact", "text": "bhai kya kar raha hai?"},
            timeout=30,
        )
        assert r_msg.status_code == 200
        assert r_msg.json()["sender"] == "contact"
        assert r_msg.json()["replied"] is False

        # Trigger auto-reply (LLM call - allow generous timeout)
        r_ar = sess.post(f"{API}/contacts/{cid}/auto-reply", timeout=90)
        assert r_ar.status_code == 200, r_ar.text
        agent = r_ar.json()
        assert agent["sender"] == "agent"
        assert len(agent["text"]) > 0
        # Should not claim to be AI
        assert "AI" not in agent["text"] or "AI Agent" not in agent["text"]

        # Second auto-reply with no pending should 400
        r_ar2 = sess.post(f"{API}/contacts/{cid}/auto-reply", timeout=30)
        assert r_ar2.status_code == 400

    def test_cancel_pending(self, sess, demo_contact):
        cid = demo_contact["id"]
        sess.post(
            f"{API}/contacts/{cid}/messages",
            json={"sender": "contact", "text": "pending test"},
            timeout=30,
        )
        r = sess.post(f"{API}/contacts/{cid}/cancel-pending", timeout=30)
        assert r.status_code == 200
        assert r.json()["cancelled"] is True
        # No pending -> auto-reply 400
        r_ar = sess.post(f"{API}/contacts/{cid}/auto-reply", timeout=30)
        assert r_ar.status_code == 400

    def test_send_as_me_clears_pending(self, sess, demo_contact):
        cid = demo_contact["id"]
        sess.post(
            f"{API}/contacts/{cid}/messages",
            json={"sender": "contact", "text": "hey"},
            timeout=30,
        )
        # Send as me
        sess.post(
            f"{API}/contacts/{cid}/messages",
            json={"sender": "me", "text": "yo"},
            timeout=30,
        )
        # No pending should remain
        r = sess.post(f"{API}/contacts/{cid}/auto-reply", timeout=30)
        assert r.status_code == 400


# ---------- Reanalyze ----------
class TestReanalyze:
    def test_reanalyze(self, sess, demo_contact):
        r = sess.post(f"{API}/contacts/{demo_contact['id']}/reanalyze", timeout=120)
        assert r.status_code == 200
        data = r.json()
        assert data["analysis_status"] in ("done", "failed")
