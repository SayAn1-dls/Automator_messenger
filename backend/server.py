import asyncio
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# WhatsApp export parsing
# ---------------------------------------------------------------------------

LINE_PATTERNS = [
    # iOS: [24/12/23, 10:23:45 PM] Name: message
    re.compile(
        r'^\[(?P<date>\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+'
        r'(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\]\s'
        r'(?P<sender>[^:]+?):\s?(?P<text>.*)$'
    ),
    # Android: 24/12/23, 10:23 pm - Name: message
    re.compile(
        r'^(?P<date>\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+'
        r'(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\s*[-\u2013]\s*'
        r'(?P<sender>[^:]+?):\s?(?P<text>.*)$'
    ),
]

SKIP_MARKERS = [
    '<media omitted>', 'image omitted', 'video omitted', 'audio omitted',
    'sticker omitted', 'gif omitted', 'document omitted', 'contact card omitted',
    'this message was deleted', 'you deleted this message',
    'messages and calls are end-to-end encrypted', 'missed voice call',
    'missed video call', '<attached:', 'waiting for this message',
    'live location shared', 'location: https://', 'poll:', 'null',
]


def _clean_line(line: str) -> str:
    # Strip invisible unicode chars WhatsApp exports include (LRM, narrow nbsp etc.)
    for ch in ('\u200e', '\u200f', '\u202a', '\u202c', '\ufeff'):
        line = line.replace(ch, '')
    line = line.replace('\u202f', ' ').replace('\u00a0', ' ')
    return line.rstrip('\n\r')


def parse_whatsapp_export(text: str) -> List[dict]:
    messages: List[dict] = []
    for raw_line in text.split('\n'):
        line = _clean_line(raw_line)
        if not line.strip():
            continue
        matched = None
        for pattern in LINE_PATTERNS:
            m = pattern.match(line)
            if m:
                matched = m
                break
        if matched:
            msg_text = matched.group('text').strip()
            lowered = msg_text.lower()
            if any(marker in lowered for marker in SKIP_MARKERS) or not msg_text:
                continue
            messages.append({
                'sender': matched.group('sender').strip(),
                'text': msg_text,
                'date': matched.group('date'),
                'time': matched.group('time'),
            })
        else:
            # Continuation of a multi-line message
            if messages and not any(marker in line.lower() for marker in SKIP_MARKERS):
                messages[-1]['text'] += '\n' + line.strip()
    return messages


# ---------------------------------------------------------------------------
# LLM helpers (Claude Sonnet 4.6 via Emergent integrations)
# ---------------------------------------------------------------------------

async def call_llm(system_message: str, prompt: str) -> str:
    chat = LlmChat(
        api_key=os.environ['EMERGENT_LLM_KEY'],
        session_id=f"wa-agent-{uuid.uuid4()}",
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-4-6")
    parts: List[str] = []
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            parts.append(ev.content)
        elif isinstance(ev, StreamDone):
            break
    return ''.join(parts).strip()


def extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1:
        raise ValueError('No JSON object found in LLM response')
    return json.loads(text[start:end + 1])


async def analyze_style(contact_id: str, my_name: str, contact_name: str) -> Optional[dict]:
    history = await db.chat_history.find(
        {'contact_id': contact_id}, {'_id': 0}
    ).sort('seq', -1).to_list(400)
    history.reverse()
    my_msgs = [m for m in history if m['sender'] == my_name][-120:]
    transcript_sample = history[-80:]
    transcript = '\n'.join(f"{m['sender']}: {m['text']}" for m in transcript_sample)
    my_texts = '\n'.join(f"- {m['text']}" for m in my_msgs)

    system = (
        "You are an expert linguistic analyst. You analyze how a person texts on WhatsApp "
        "so an AI agent can imitate them perfectly. Always answer with ONLY a valid JSON object, no prose."
    )
    prompt = (
        f"Below is a WhatsApp conversation between {my_name} and {contact_name}.\n\n"
        f"CONVERSATION SAMPLE:\n{transcript}\n\n"
        f"ALL MESSAGES WRITTEN BY {my_name}:\n{my_texts}\n\n"
        f"Analyze how {my_name} texts with {contact_name}. Return ONLY a JSON object with exactly these keys:\n"
        '{"languages": ["list of languages/dialects used, e.g. English, Hinglish, Hindi"],\n'
        '"tone": "short description of tone",\n'
        '"formality": "very informal | informal | neutral | formal",\n'
        '"emoji_usage": "none | rare | occasional | frequent",\n'
        '"avg_message_length": "very short | short | medium | long",\n'
        '"common_phrases": ["up to 6 phrases/words they actually use often"],\n'
        '"greeting_style": "how they typically greet or open messages",\n'
        '"quirks": "typing quirks: abbreviations, punctuation habits, laughter style etc.",\n'
        '"relationship": "best guess: friend, family, colleague, partner etc.",\n'
        '"style_summary": "2-3 sentence summary of how to imitate this person"}'
    )
    try:
        raw = await call_llm(system, prompt)
        return extract_json(raw)
    except Exception as e:
        logger.error(f"Style analysis failed for {contact_id}: {e}")
        return None


async def generate_auto_reply(contact: dict, pending: List[dict], recent: List[dict]) -> str:
    my_name = contact['my_name']
    contact_name = contact['name']
    profile = contact.get('style_profile')
    profile_txt = json.dumps(profile, ensure_ascii=False) if profile else 'not available'

    history = await db.chat_history.find(
        {'contact_id': contact['id'], 'sender': my_name}, {'_id': 0}
    ).sort('seq', -1).to_list(40)
    history.reverse()
    examples = '\n'.join(f"- {m['text']}" for m in history)

    transcript = '\n'.join(
        f"{contact_name if m['sender'] == 'contact' else my_name}: {m['text']}"
        for m in recent
    )
    pending_txt = '\n'.join(f"{contact_name}: {m['text']}" for m in pending)

    system = (
        f"You are an AI agent replying on WhatsApp AS {my_name}, because {my_name} is away from their phone. "
        f"You must write EXACTLY like {my_name} texts with {contact_name} — same language(s), script, slang, tone, "
        f"emoji habits, punctuation and typical message length.\n\n"
        f"STYLE PROFILE of {my_name} with {contact_name}:\n{profile_txt}\n\n"
        f"REAL EXAMPLES of how {my_name} texts {contact_name}:\n{examples}\n\n"
        "RULES:\n"
        f"1. Reply in the same language/style {my_name} uses (if they text in Hinglish, reply in Hinglish).\n"
        "2. Keep it natural and about the same length as their usual messages — usually short.\n"
        "3. NEVER say you are an AI, bot or agent. Never break character.\n"
        f"4. If asked something only {my_name} could know or decide (plans, money, private info), respond vaguely "
        f"and naturally defer, e.g. say you'll confirm in a bit — the way {my_name} would phrase it.\n"
        "5. Output ONLY the reply message text. No quotes, no name prefix, no explanations."
    )
    custom = (contact.get('custom_instructions') or '').strip()
    if custom:
        system += (
            f"\n\nADDITIONAL RULES set by {my_name} for this chat — these OVERRIDE everything above and MUST be followed:\n{custom}"
        )
    prompt = (
        f"RECENT CONVERSATION:\n{transcript if transcript else '(no earlier messages in this session)'}\n\n"
        f"NEW UNREAD MESSAGE(S) from {contact_name} that {my_name} has not seen:\n{pending_txt}\n\n"
        f"Write {my_name}'s reply now:"
    )
    reply = await call_llm(system, prompt)
    reply = reply.strip().strip('"').strip()
    return reply


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ImportPreviewRequest(BaseModel):
    chat_text: str


class ImportConfirmRequest(BaseModel):
    chat_text: str
    my_name: str
    contact_name: str
    display_name: Optional[str] = None


class SettingsUpdate(BaseModel):
    away_mode: bool


class ContactUpdate(BaseModel):
    auto_reply_enabled: Optional[bool] = None
    auto_reply_delay_seconds: Optional[int] = Field(default=None, ge=3, le=1800)
    custom_instructions: Optional[str] = Field(default=None, max_length=2000)
    wa_number: Optional[str] = Field(default=None, max_length=25)


class SimMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    sender: Literal['contact', 'me']


# ---------------------------------------------------------------------------
# Settings endpoints
# ---------------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "WhatsApp AI Agent backend running"}


@api_router.get("/settings")
async def get_settings():
    doc = await db.settings.find_one({'key': 'global'}, {'_id': 0})
    if not doc:
        doc = {'key': 'global', 'away_mode': True}
        await db.settings.insert_one({**doc})
    return {'away_mode': doc.get('away_mode', True)}


@api_router.patch("/settings")
async def update_settings(body: SettingsUpdate):
    await db.settings.update_one(
        {'key': 'global'},
        {'$set': {'away_mode': body.away_mode}},
        upsert=True,
    )
    return {'away_mode': body.away_mode}


# ---------------------------------------------------------------------------
# Import endpoints
# ---------------------------------------------------------------------------

@api_router.post("/import/preview")
async def import_preview(body: ImportPreviewRequest):
    messages = parse_whatsapp_export(body.chat_text)
    if len(messages) < 4:
        raise HTTPException(
            status_code=400,
            detail="Could not find enough messages. Make sure you pasted a WhatsApp chat export (.txt) — Chat > More > Export chat > Without media.",
        )
    counts: dict = {}
    for m in messages:
        counts[m['sender']] = counts.get(m['sender'], 0) + 1
    participants = [
        {'name': name, 'message_count': count}
        for name, count in sorted(counts.items(), key=lambda x: -x[1])
    ]
    return {'participants': participants, 'total_messages': len(messages)}


async def _create_contact_from_export(chat_text: str, my_name: str, contact_name: str, display_name: Optional[str]) -> dict:
    messages = parse_whatsapp_export(chat_text)
    relevant = [m for m in messages if m['sender'] in (my_name, contact_name)]
    if len(relevant) < 4:
        raise HTTPException(status_code=400, detail="Not enough messages between these two participants.")

    contact_id = str(uuid.uuid4())
    contact = {
        'id': contact_id,
        'name': display_name or contact_name,
        'export_contact_name': contact_name,
        'my_name': my_name,
        'message_count': len(relevant),
        'style_profile': None,
        'analysis_status': 'analyzing',
        'auto_reply_enabled': True,
        'auto_reply_delay_seconds': 15,
        'custom_instructions': '',
        'wa_number': None,
        'last_message': None,
        'last_message_at': None,
        'created_at': now_iso(),
    }
    await db.contacts.insert_one({**contact})

    history_docs = [
        {
            'id': str(uuid.uuid4()),
            'contact_id': contact_id,
            'seq': i,
            'sender': m['sender'],
            'text': m['text'],
            'date': m['date'],
            'time': m['time'],
        }
        for i, m in enumerate(relevant)
    ]
    await db.chat_history.insert_many([{**d} for d in history_docs])

    profile = await analyze_style(contact_id, my_name, contact_name)
    status = 'done' if profile else 'failed'
    await db.contacts.update_one(
        {'id': contact_id},
        {'$set': {'style_profile': profile, 'analysis_status': status}},
    )
    contact['style_profile'] = profile
    contact['analysis_status'] = status
    return contact


@api_router.post("/import/confirm")
async def import_confirm(body: ImportConfirmRequest):
    if body.my_name.strip() == body.contact_name.strip():
        raise HTTPException(status_code=400, detail="'You' and the contact must be different participants.")
    return await _create_contact_from_export(body.chat_text, body.my_name.strip(), body.contact_name.strip(), body.display_name)


DEMO_CHAT = """12/03/25, 9:14 pm - Rahul: Bro kal match dekha??
12/03/25, 9:16 pm - Arjun: haan bhai kya match tha 🔥🔥
12/03/25, 9:16 pm - Arjun: last over me to dil hi ruk gaya tha
12/03/25, 9:17 pm - Rahul: sahi me yaar, bumrah ne to aag laga di
12/03/25, 9:18 pm - Arjun: bilkul bhai, GOAT hai GOAT 🐐
12/03/25, 9:20 pm - Rahul: weekend pe milte kya? bahut din hogaye
12/03/25, 9:22 pm - Arjun: haan chal na, saturday evening?
12/03/25, 9:22 pm - Arjun: CCD wali jagah pe aaja 7 baje
12/03/25, 9:23 pm - Rahul: done bro 👍
13/03/25, 11:02 am - Rahul: bhai ek kaam tha
13/03/25, 11:02 am - Rahul: wo assignment ka pdf bhejna jo sir ne diya tha
13/03/25, 11:45 am - Arjun: haan ruk abhi bhejta hu
13/03/25, 11:46 am - Arjun: bhej diya check kar
13/03/25, 11:47 am - Rahul: mil gaya, thanks bhai ❤️
13/03/25, 11:48 am - Arjun: koi na bro 😄
14/03/25, 8:30 pm - Rahul: khaana khaya?
14/03/25, 8:45 pm - Arjun: haan bas abhi khatam kiya, tu bata
14/03/25, 8:46 pm - Rahul: mummy ne rajma chawal banaya aaj 😋
14/03/25, 8:47 pm - Arjun: wah bhai maze hai tere to
14/03/25, 8:47 pm - Arjun: mere yaha to roz wahi dal roti 😭
14/03/25, 8:48 pm - Rahul: 😂😂
15/03/25, 6:10 pm - Rahul: bro kal ka plan pakka hai na?
15/03/25, 6:30 pm - Arjun: haan bhai pakka, 7 baje CCD
15/03/25, 6:31 pm - Arjun: late mat aana warna teri treat 😤
15/03/25, 6:32 pm - Rahul: haha thik hai thik hai
16/03/25, 5:05 pm - Rahul: nikal raha hu ghar se
16/03/25, 5:20 pm - Arjun: main bhi bas 10 min me niklunga bro
16/03/25, 7:05 pm - Rahul: pahunch gaya, kaha hai tu
16/03/25, 7:06 pm - Arjun: 2 min bhai, parking kar raha hu
16/03/25, 9:30 pm - Rahul: aaj maza aaya bro, agle week fir milte hai
16/03/25, 9:32 pm - Arjun: pakka bhai 🤜🤛 ghar pahunch ke msg karna
16/03/25, 9:50 pm - Rahul: pahunch gaya safe
16/03/25, 9:51 pm - Arjun: nice, gn bro 😴
16/03/25, 9:51 pm - Rahul: gn 🌙"""


@api_router.post("/demo")
async def load_demo():
    existing = await db.contacts.find_one({'name': 'Rahul (Demo)'}, {'_id': 0})
    if existing:
        return existing
    return await _create_contact_from_export(DEMO_CHAT, 'Arjun', 'Rahul', 'Rahul (Demo)')


# ---------------------------------------------------------------------------
# Contact endpoints
# ---------------------------------------------------------------------------

@api_router.get("/contacts")
async def list_contacts():
    contacts = await db.contacts.find({}, {'_id': 0}).sort('created_at', -1).to_list(200)
    contacts.sort(key=lambda c: c.get('last_message_at') or c['created_at'], reverse=True)
    return contacts


async def _get_contact_or_404(contact_id: str) -> dict:
    contact = await db.contacts.find_one({'id': contact_id}, {'_id': 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@api_router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str):
    return await _get_contact_or_404(contact_id)


@api_router.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate):
    await _get_contact_or_404(contact_id)
    updates = dict(body.dict(exclude_unset=True))
    if 'wa_number' in updates:
        digits = re.sub(r'\D', '', updates['wa_number'] or '')
        updates['wa_number'] = digits or None
    if 'custom_instructions' in updates:
        updates['custom_instructions'] = (updates['custom_instructions'] or '').strip()
    if updates:
        await db.contacts.update_one({'id': contact_id}, {'$set': updates})
    return await _get_contact_or_404(contact_id)


@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    await _get_contact_or_404(contact_id)
    await db.contacts.delete_one({'id': contact_id})
    await db.chat_history.delete_many({'contact_id': contact_id})
    await db.sim_messages.delete_many({'contact_id': contact_id})
    return {'deleted': True}


@api_router.post("/contacts/{contact_id}/reanalyze")
async def reanalyze_contact(contact_id: str):
    contact = await _get_contact_or_404(contact_id)
    await db.contacts.update_one({'id': contact_id}, {'$set': {'analysis_status': 'analyzing'}})
    profile = await analyze_style(contact_id, contact['my_name'], contact['export_contact_name'])
    status = 'done' if profile else 'failed'
    await db.contacts.update_one(
        {'id': contact_id},
        {'$set': {'style_profile': profile, 'analysis_status': status}},
    )
    return await _get_contact_or_404(contact_id)


# ---------------------------------------------------------------------------
# Simulator message endpoints
# ---------------------------------------------------------------------------

@api_router.get("/contacts/{contact_id}/messages")
async def get_messages(contact_id: str):
    await _get_contact_or_404(contact_id)
    messages = await db.sim_messages.find(
        {'contact_id': contact_id}, {'_id': 0}
    ).sort('created_at', 1).to_list(500)
    return messages


@api_router.post("/contacts/{contact_id}/messages")
async def create_message(contact_id: str, body: SimMessageCreate):
    contact = await _get_contact_or_404(contact_id)
    message = {
        'id': str(uuid.uuid4()),
        'contact_id': contact_id,
        'sender': body.sender,
        'text': body.text.strip(),
        'replied': False,
        'created_at': now_iso(),
    }
    await db.sim_messages.insert_one({**message})
    if body.sender == 'me':
        # User replied themselves — pending incoming messages are handled
        await db.sim_messages.update_many(
            {'contact_id': contact_id, 'sender': 'contact', 'replied': False},
            {'$set': {'replied': True}},
        )
    preview = ('You: ' if body.sender == 'me' else f"{contact['name']}: ") + message['text']
    await db.contacts.update_one(
        {'id': contact_id},
        {'$set': {'last_message': preview[:80], 'last_message_at': message['created_at']}},
    )
    return message


@api_router.post("/contacts/{contact_id}/cancel-pending")
async def cancel_pending(contact_id: str):
    await _get_contact_or_404(contact_id)
    await db.sim_messages.update_many(
        {'contact_id': contact_id, 'sender': 'contact', 'replied': False},
        {'$set': {'replied': True}},
    )
    return {'cancelled': True}


@api_router.post("/contacts/{contact_id}/auto-reply")
async def auto_reply(contact_id: str):
    contact = await _get_contact_or_404(contact_id)
    pending = await db.sim_messages.find(
        {'contact_id': contact_id, 'sender': 'contact', 'replied': False},
        {'_id': 0},
    ).sort('created_at', 1).to_list(50)
    if not pending:
        raise HTTPException(status_code=400, detail="No unread messages to reply to.")

    all_msgs = await db.sim_messages.find(
        {'contact_id': contact_id}, {'_id': 0}
    ).sort('created_at', 1).to_list(500)
    pending_ids = {m['id'] for m in pending}
    recent = [m for m in all_msgs if m['id'] not in pending_ids][-24:]

    try:
        reply_text = await generate_auto_reply(contact, pending, recent)
    except Exception as e:
        logger.error(f"Auto-reply generation failed: {e}")
        await log_reply('simulator', 'failed', ' | '.join(p['text'] for p in pending),
                        contact_id=contact_id, contact_name=contact['name'], reason=str(e)[:200])
        raise HTTPException(status_code=502, detail="AI reply generation failed. Please try again.")

    if not reply_text:
        raise HTTPException(status_code=502, detail="AI returned an empty reply. Please try again.")

    agent_message = {
        'id': str(uuid.uuid4()),
        'contact_id': contact_id,
        'sender': 'agent',
        'text': reply_text,
        'replied': True,
        'created_at': now_iso(),
    }
    await db.sim_messages.insert_one({**agent_message})
    await db.sim_messages.update_many(
        {'contact_id': contact_id, 'sender': 'contact', 'replied': False},
        {'$set': {'replied': True}},
    )
    await db.contacts.update_one(
        {'id': contact_id},
        {'$set': {'last_message': f"🤖 {reply_text[:76]}", 'last_message_at': agent_message['created_at']}},
    )
    return agent_message


# ---------------------------------------------------------------------------
# Auto-reply activity log
# ---------------------------------------------------------------------------

async def log_reply(source: str, status: str, incoming_text: str, reply_text: Optional[str] = None,
                    contact_id: Optional[str] = None, contact_name: Optional[str] = None,
                    reason: Optional[str] = None):
    await db.reply_log.insert_one({
        'id': str(uuid.uuid4()),
        'source': source,          # 'simulator' | 'whatsapp'
        'status': status,          # 'sent' | 'skipped' | 'failed'
        'incoming_text': incoming_text[:500],
        'reply_text': (reply_text or '')[:1000] or None,
        'contact_id': contact_id,
        'contact_name': contact_name,
        'reason': reason,
        'created_at': now_iso(),
    })


@api_router.get("/logs")
async def get_logs(limit: int = 100):
    return await db.reply_log.find({}, {'_id': 0}).sort('created_at', -1).to_list(min(limit, 300))


# ---------------------------------------------------------------------------
# WhatsApp Business Cloud API (live mode)
# ---------------------------------------------------------------------------

GRAPH_API_VERSION = "v21.0"


class WaConfigUpdate(BaseModel):
    access_token: str = Field(min_length=10)
    phone_number_id: str = Field(min_length=5)


async def get_wa_config() -> dict:
    cfg = await db.settings.find_one({'key': 'whatsapp'}, {'_id': 0})
    if not cfg:
        cfg = {'key': 'whatsapp', 'verify_token': secrets.token_hex(12),
               'access_token': None, 'phone_number_id': None,
               'connected': False, 'display_phone_number': None, 'verified_name': None}
        await db.settings.insert_one({**cfg})
    return cfg


def wa_config_public(cfg: dict) -> dict:
    token = cfg.get('access_token')
    return {
        'connected': cfg.get('connected', False),
        'phone_number_id': cfg.get('phone_number_id'),
        'display_phone_number': cfg.get('display_phone_number'),
        'verified_name': cfg.get('verified_name'),
        'verify_token': cfg['verify_token'],
        'access_token_masked': f"…{token[-6:]}" if token else None,
        'webhook_path': '/api/whatsapp/webhook',
    }


@api_router.get("/whatsapp/config")
async def whatsapp_config():
    return wa_config_public(await get_wa_config())


@api_router.post("/whatsapp/config")
async def whatsapp_connect(body: WaConfigUpdate):
    await get_wa_config()
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{body.phone_number_id.strip()}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            res = await http.get(
                url,
                params={'fields': 'display_phone_number,verified_name'},
                headers={'Authorization': f"Bearer {body.access_token.strip()}"},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach the Meta Graph API. Try again.")
    if res.status_code != 200:
        detail = "Meta rejected the credentials. Check the access token and phone number ID."
        try:
            err = res.json().get('error', {})
            if err.get('message'):
                detail = f"Meta error: {err['message']}"
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)
    data = res.json()
    await db.settings.update_one(
        {'key': 'whatsapp'},
        {'$set': {
            'access_token': body.access_token.strip(),
            'phone_number_id': body.phone_number_id.strip(),
            'connected': True,
            'display_phone_number': data.get('display_phone_number'),
            'verified_name': data.get('verified_name'),
        }},
    )
    return wa_config_public(await get_wa_config())


@api_router.delete("/whatsapp/config")
async def whatsapp_disconnect():
    await get_wa_config()
    await db.settings.update_one(
        {'key': 'whatsapp'},
        {'$set': {'access_token': None, 'phone_number_id': None, 'connected': False,
                  'display_phone_number': None, 'verified_name': None}},
    )
    return wa_config_public(await get_wa_config())


async def send_whatsapp_text(cfg: dict, to: str, body_text: str) -> None:
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{cfg['phone_number_id']}/messages"
    payload = {
        'messaging_product': 'whatsapp',
        'recipient_type': 'individual',
        'to': to,
        'type': 'text',
        'text': {'preview_url': False, 'body': body_text},
    }
    async with httpx.AsyncClient(timeout=15.0) as http:
        res = await http.post(url, json=payload, headers={'Authorization': f"Bearer {cfg['access_token']}"})
        res.raise_for_status()


@api_router.get("/whatsapp/webhook")
async def whatsapp_webhook_verify(request: Request):
    params = request.query_params
    cfg = await get_wa_config()
    if params.get('hub.mode') == 'subscribe' and params.get('hub.verify_token') == cfg['verify_token']:
        return PlainTextResponse(params.get('hub.challenge', ''))
    raise HTTPException(status_code=403, detail="Webhook verification failed")


async def _live_auto_reply_task(contact_id: str, wa_number: str, delay: int):
    try:
        await asyncio.sleep(delay)
        contact = await db.contacts.find_one({'id': contact_id}, {'_id': 0})
        if not contact:
            return
        pending = await db.sim_messages.find(
            {'contact_id': contact_id, 'sender': 'contact', 'replied': False}, {'_id': 0}
        ).sort('created_at', 1).to_list(50)
        if not pending:
            return
        incoming_text = ' | '.join(p['text'] for p in pending)
        settings = await db.settings.find_one({'key': 'global'}, {'_id': 0}) or {}
        if not settings.get('away_mode', True) or not contact.get('auto_reply_enabled', True):
            await log_reply('whatsapp', 'skipped', incoming_text, contact_id=contact_id,
                            contact_name=contact['name'], reason='Away mode or agent turned off before reply fired')
            return
        all_msgs = await db.sim_messages.find(
            {'contact_id': contact_id}, {'_id': 0}
        ).sort('created_at', 1).to_list(500)
        pending_ids = {m['id'] for m in pending}
        recent = [m for m in all_msgs if m['id'] not in pending_ids][-24:]
        try:
            reply_text = await generate_auto_reply(contact, pending, recent)
            cfg = await get_wa_config()
            if not cfg.get('connected'):
                raise RuntimeError('WhatsApp disconnected')
            await send_whatsapp_text(cfg, wa_number, reply_text)
        except Exception as e:
            logger.error(f"Live auto-reply failed: {e}")
            await log_reply('whatsapp', 'failed', incoming_text, contact_id=contact_id,
                            contact_name=contact['name'], reason=str(e)[:200])
            return
        agent_message = {
            'id': str(uuid.uuid4()), 'contact_id': contact_id, 'sender': 'agent',
            'text': reply_text, 'replied': True, 'created_at': now_iso(),
        }
        await db.sim_messages.insert_one({**agent_message})
        await db.sim_messages.update_many(
            {'contact_id': contact_id, 'sender': 'contact', 'replied': False},
            {'$set': {'replied': True}},
        )
        await db.contacts.update_one(
            {'id': contact_id},
            {'$set': {'last_message': f"🤖 {reply_text[:76]}", 'last_message_at': agent_message['created_at']}},
        )
        await log_reply('whatsapp', 'sent', incoming_text, reply_text=reply_text,
                        contact_id=contact_id, contact_name=contact['name'])
    except Exception as e:
        logger.error(f"Live auto-reply task crashed: {e}")


@api_router.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return {'status': 'ok'}
    try:
        for entry in payload.get('entry', []):
            for change in entry.get('changes', []):
                value = change.get('value', {})
                for msg in value.get('messages', []):
                    if msg.get('type') != 'text':
                        continue
                    wa_number = re.sub(r'\D', '', msg.get('from', ''))
                    text = msg.get('text', {}).get('body', '').strip()
                    if not wa_number or not text:
                        continue
                    contact = await db.contacts.find_one({'wa_number': wa_number}, {'_id': 0})
                    if not contact:
                        await log_reply('whatsapp', 'skipped', text,
                                        reason=f'Unknown number +{wa_number} — no linked contact')
                        continue
                    incoming = {
                        'id': str(uuid.uuid4()), 'contact_id': contact['id'], 'sender': 'contact',
                        'text': text, 'replied': False, 'created_at': now_iso(),
                    }
                    await db.sim_messages.insert_one({**incoming})
                    await db.contacts.update_one(
                        {'id': contact['id']},
                        {'$set': {'last_message': f"{contact['name']}: {text}"[:80],
                                  'last_message_at': incoming['created_at']}},
                    )
                    settings = await db.settings.find_one({'key': 'global'}, {'_id': 0}) or {}
                    if not settings.get('away_mode', True):
                        await log_reply('whatsapp', 'skipped', text, contact_id=contact['id'],
                                        contact_name=contact['name'], reason='Away mode is off')
                        continue
                    if not contact.get('auto_reply_enabled', True):
                        await log_reply('whatsapp', 'skipped', text, contact_id=contact['id'],
                                        contact_name=contact['name'], reason='Agent disabled for this contact')
                        continue
                    asyncio.create_task(_live_auto_reply_task(
                        contact['id'], wa_number, contact.get('auto_reply_delay_seconds', 15)
                    ))
    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
    return {'status': 'ok'}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
