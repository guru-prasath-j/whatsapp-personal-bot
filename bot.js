/**
 * WhatsApp Personal Bot + Dashboard
 * - whatsapp-web.js handles WhatsApp
 * - Express + Socket.io powers the React dashboard
 * - Incoming messages → AI suggestion → shown in dashboard for human review
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const fs        = require('fs');
const path      = require('path');
const axios     = require('axios');
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const { getAIResponse, getSuggestions, sendCorrection, summarizeHistory } = require('./rag');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME        = process.env.BOT_NAME          || 'WhatsApp Brain';
const TYPING_DELAY    = parseInt(process.env.TYPING_DELAY)      || 2000;
const ALLOWED_NUMS    = process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];
const HISTORY_TTL_MS  = parseInt(process.env.HISTORY_TTL_HOURS || '48') * 60 * 60 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL      || 'llama3.2';
const PORT            = parseInt(process.env.PORT)    || 3000;

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// ── Persistence ───────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'conversation_history.json');
const MAX_HISTORY  = 40;

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            const map = new Map();
            for (const [sender, value] of Object.entries(raw)) {
                if (Array.isArray(value)) {
                    map.set(sender, { messages: value.map(m => ({ ...m, ts: m.ts || Date.now() })), lastActivity: Date.now() });
                } else {
                    map.set(sender, value);
                }
            }
            return map;
        }
    } catch { /* ignore corrupt */ }
    return new Map();
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(Object.fromEntries(conversationHistory)), 'utf8');
    } catch (e) { console.error('[History] Save failed:', e.message); }
}

const conversationHistory = loadHistory();
console.log(`[History] Loaded for ${conversationHistory.size} contact(s)`);

function getRecord(sender) {
    if (!conversationHistory.has(sender))
        conversationHistory.set(sender, { messages: [], lastActivity: Date.now() });
    return conversationHistory.get(sender);
}

function getHistory(sender) {
    const rec = getRecord(sender);
    if (rec.lastActivity < Date.now() - HISTORY_TTL_MS) {
        console.log(`[History] Expired for ${sender}`);
        rec.messages = [];
    }
    return rec.messages.map(m => ({ role: m.role, content: m.content }));
}

function addToHistory(sender, role, content) {
    const rec = getRecord(sender);
    rec.messages.push({ role, content, ts: Date.now() });
    rec.lastActivity = Date.now();
    if (role === 'user') rec.unread = (rec.unread || 0) + 1;
    if (role === 'assistant') rec.unread = 0;
    if (rec.messages.length > MAX_HISTORY)
        rec.messages.splice(0, rec.messages.length - MAX_HISTORY);

    // Auto-update customer profile when new user message arrives (#3)
    if (role === 'user') updateCustomerProfile(sender, content);

    // Auto-summarise when history gets long (#9)
    if (rec.messages.length >= MAX_HISTORY && !rec._summarizing) {
        rec._summarizing = true;
        const oldMsgs = rec.messages.slice(0, MAX_HISTORY - 10)
            .map(m => ({ role: m.role, content: m.content }));
        summarizeHistory(oldMsgs).then(summary => {
            if (summary) {
                rec.customerProfile        = rec.customerProfile || {};
                rec.customerProfile.summary = summary;
                saveHistory();
                console.log(`[Summary] Updated summary for ${sender}`);
            }
            rec._summarizing = false;
        }).catch(() => { rec._summarizing = false; });
    }

    saveHistory();
}

/**
 * Build/update a lightweight customer profile from their messages (#3).
 * Extracts: language, interest keywords, price mentions.
 */
function updateCustomerProfile(sender, message) {
    const rec     = getRecord(sender);
    const profile = rec.customerProfile || {};

    // Language detection via Unicode (#7)
    const hasTamil  = /[஀-௿]/.test(message);
    const hasHindi  = /[ऀ-ॿ]/.test(message);
    if      (hasTamil) profile.language = 'Tamil';
    else if (hasHindi) profile.language = 'Hindi';
    else               profile.language = profile.language || 'English';

    // Extract price mentions
    const prices = message.match(/₹[\d,]+|rs\.?\s*[\d,]+|\d+k\b/gi) || [];
    if (prices.length) {
        profile.quoted_prices = [...new Set([...(profile.quoted_prices || []), ...prices])].slice(-5);
    }

    // Extract interest keywords (nouns after "I want", "need", "looking for")
    const interestMatch = message.match(/(?:want|need|looking for|interested in)\s+(.{3,40})/i);
    if (interestMatch) {
        profile.interests = [...new Set([...(profile.interests || []), interestMatch[1].trim()])].slice(-8);
    }

    rec.customerProfile = profile;
}

function getCustomerProfile(sender) {
    return getRecord(sender).customerProfile || {};
}

// ── State ─────────────────────────────────────────────────────────────────────
const processedMessages = new Set();
const pausedContacts    = new Map();
const replyTimers       = new Map(); // debounce: contactId → setTimeout handle
const lastMessages      = new Map(); // debounce: contactId → latest pending text
let   globalPaused      = true; // semi-auto: bot never auto-replies, use dashboard to send
let   botStatus         = 'connecting';

const pendingMessages = new Map();

function isPaused(sender) {
    if (globalPaused) return true;
    const exp = pausedContacts.get(sender);
    if (!exp) return false;
    if (Date.now() > exp) { pausedContacts.delete(sender); return false; }
    return true;
}

// ── Media helpers ─────────────────────────────────────────────────────────────
function tryRequire(pkg) { try { return require(pkg); } catch { return null; } }

async function describeImageWithVision(base64Data, mime) {
    const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';
    try {
        const resp = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: VISION_MODEL,
            messages: [{ role: 'user', content: 'Describe this image. Extract any text visible.', images: [base64Data] }],
            stream: false
        }, { timeout: 60000 });
        return `[Customer sent an image. Contents: ${resp.data.message?.content || ''}]`;
    } catch {
        return `[Customer sent an image (${mime}). Vision model unavailable — ask them to describe it in text.]`;
    }
}

async function describeMedia(message) {
    try {
        const media = await message.downloadMedia();
        if (!media) return null;
        const mime = media.mimetype || '';
        const buf  = Buffer.from(media.data, 'base64');

        if (mime.startsWith('image/'))
            return await describeImageWithVision(media.data, mime);

        if (mime.includes('pdf')) {
            const pdfParse = tryRequire('pdf-parse');
            if (pdfParse) {
                const data = await pdfParse(buf);
                const text = data.text?.trim().substring(0, 3000);
                if (text) return `[Customer sent a PDF. Contents:\n${text}]`;
            }
            return `[Customer sent a PDF. Ask them to paste the relevant text.]`;
        }

        if (mime.includes('word') || mime.includes('wordprocessingml')) {
            const mammoth = tryRequire('mammoth');
            if (mammoth) {
                const result = await mammoth.extractRawText({ buffer: buf });
                const text = result.value?.trim().substring(0, 3000);
                if (text) return `[Customer sent a Word document. Contents:\n${text}]`;
            }
            return `[Customer sent a Word doc. Ask them to paste the relevant text.]`;
        }

        if (mime.startsWith('text/'))
            return `[Customer sent a text file:\n${buf.toString('utf8').substring(0, 3000)}]`;

        if (mime.startsWith('audio/'))
            return `[Customer sent a voice/audio message. Let them know you can't process audio yet.]`;

        if (mime.startsWith('video/'))
            return `[Customer sent a video. Ask them to describe what they need.]`;

        return `[Customer sent a file (${mime}). Acknowledge and ask how you can help.]`;
    } catch (e) {
        console.error('[Media] Failed:', e.message);
        return null;
    }
}

// ── Seed history from WhatsApp ────────────────────────────────────────────────
/**
 * When a contact messages for the first time after a fresh bot start,
 * fetch their last 20 messages from WhatsApp and seed the history.
 */
async function seedHistoryFromWhatsApp(message, senderNumber) {
    try {
        const chat = await message.getChat();
        const past = await chat.fetchMessages({ limit: 40 });
        if (!past || past.length === 0) return;

        const rec = getRecord(senderNumber);
        const seeded = [];

        for (const msg of past) {
            if (msg.isStatus || !msg.body?.trim()) continue;
            // Skip the current message itself (we'll add it via addToHistory)
            if (msg.id._serialized === message.id._serialized) continue;
            seeded.push({
                role:    msg.fromMe ? 'assistant' : 'user',
                content: msg.body.trim(),
                ts:      msg.timestamp * 1000
            });
        }

        if (seeded.length > 0) {
            // Sort by timestamp, keep last 20
            seeded.sort((a, b) => a.ts - b.ts);
            rec.messages = seeded.slice(-40);
            rec.lastActivity = seeded[seeded.length - 1].ts;
            saveHistory();
            console.log(`[Seed] Loaded ${seeded.length} past messages for ${senderNumber}`);
        }
    } catch (e) {
        console.warn(`[Seed] Could not fetch history for ${senderNumber}:`, e.message);
    }
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-brain' }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu']
    }
});

// ── WhatsApp Events ───────────────────────────────────────────────────────────
client.on('qr', (qr) => {
    botStatus = 'qr';
    io.emit('bot_status', { status: 'qr' });
    console.log('\nScan QR code:\n');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Authenticated'));
client.on('auth_failure',  (m) => console.error('❌ Auth failed:', m));

client.on('ready', async () => {
    botStatus = 'ready';
    io.emit('bot_status', { status: 'ready' });
    console.log(`\n✅ ${BOT_NAME} is LIVE — Dashboard: http://localhost:${PORT}\n`);

    // Load ALL chats from WhatsApp (like WhatsApp Web does on startup)
    console.log('[Sync] Loading all chats from WhatsApp...');
    try {
        const chats = await client.getChats();
        const allDm = chats.filter(c => !c.isGroup);
        const dmChats = allDm.slice(0, 20); // fetch 20, expect ~10 valid after skipping errors
        console.log(`[Sync] Loading recent chats (${allDm.length} total DMs)...`);

        for (const chat of dmChats) {
            try {
                const contactId = chat.id.user; // numeric ID without @suffix
                const rec = getRecord(contactId);

                // Fetch up to 40 messages for this chat
                const msgs = await chat.fetchMessages({ limit: 40 });
                if (!msgs || msgs.length === 0) continue;

                // Build message history (only text messages)
                const seeded = msgs
                    .filter(m => m.body?.trim() && !m.isStatus)
                    .map(m => ({
                        role:    m.fromMe ? 'assistant' : 'user',
                        content: m.body.trim(),
                        ts:      m.timestamp * 1000
                    }))
                    .sort((a, b) => a.ts - b.ts)
                    .slice(-40);

                if (seeded.length > 0) {
                    rec.messages     = seeded;
                    rec.lastActivity = seeded[seeded.length - 1].ts;
                    rec.waId         = chat.id._serialized;
                }

                // Get contact name & profile pic
                if (!rec.manualName) {
                    const contact = chat.contact || await client.getContactById(chat.id._serialized).catch(() => null);
                    if (contact) {
                        rec.name       = contact.pushname || contact.name || contact.number || contactId;
                        rec.realNumber = contact.number || contactId;
                        if (!rec.profilePic) {
                            try { rec.profilePic = await contact.getProfilePicUrl(); } catch {}
                        }
                    }
                }

                console.log(`[Sync] ${rec.name || contactId}: ${seeded.length} messages`);

                // Push update to dashboard every 5 chats so UI populates progressively
                if (dmChats.indexOf(chat) % 5 === 0) io.emit('conversation_updated');

            } catch (e) {
                // Silently skip chats that throw LID/internal WhatsApp errors
            }
        }

        saveHistory();
        io.emit('conversation_updated');
        console.log(`[Sync] Done — ${dmChats.length} chats loaded`);
    } catch (e) {
        console.error('[Sync] Failed to load chats:', e.message);
    }
});

// Capture YOUR outgoing messages (message_create fires for all messages incl. received)
client.on('message_create', async (message) => {
    if (!message.fromMe || message.isStatus) return;  // only YOUR sent messages
    if (processedMessages.has(message.id._serialized)) return; // skip already-processed
    const to = (message.to || '').replace(/@c\.us$|@lid$/, '');
    if (!to || message.to?.endsWith('@g.us')) return;
    const text = message.body?.trim();
    if (!text) return;

    if (text.startsWith('!pause')) {
        const target = text.split(' ')[1]?.trim() || '';
        if (target === 'all') { globalPaused = true; io.emit('pause_changed', { globalPaused: true }); console.log('[Bot] Globally PAUSED'); }
        else if (target) { pausedContacts.set(target, Infinity); io.emit('pause_changed', { globalPaused }); console.log(`[Bot] Paused for ${target}`); }
        return;
    }
    if (text.startsWith('!play')) {
        const target = text.split(' ')[1]?.trim() || '';
        if (target === 'all') { globalPaused = false; pausedContacts.clear(); io.emit('pause_changed', { globalPaused: false }); console.log('[Bot] Globally RESUMED'); }
        else if (target) { pausedContacts.delete(target); io.emit('pause_changed', { globalPaused }); console.log(`[Bot] Resumed for ${target}`); }
        return;
    }

    // Store bot/manual reply in history (single source of truth for outgoing messages)
    addToHistory(to, 'assistant', text);
    io.emit('conversation_updated');
    console.log(`[History] Saved reply to ${to}`);
});

// Incoming messages
client.on('message', async (message) => {
    try {
        if (processedMessages.has(message.id._serialized)) return;
        processedMessages.add(message.id._serialized);
        if (message.isStatus || message.fromMe) return;
        if (message.from.endsWith('@g.us')) return;

        const senderNumber = message.from.replace(/@c\.us$|@lid$/, '');
        if (ALLOWED_NUMS.length > 0 && !ALLOWED_NUMS.includes(senderNumber)) return;

        let userText = message.body?.trim();
        if (!userText && message.hasMedia) userText = await describeMedia(message);
        if (!userText) return;

        console.log(`[MSG] From ${senderNumber}: ${userText.substring(0, 80)}`);

        addToHistory(senderNumber, 'user', userText);

        const contact    = await message.getContact();
        const name       = contact.pushname || contact.name || contact.number || senderNumber;
        const realNumber = contact.number || senderNumber;

        // Fetch profile picture URL (gracefully)
        let profilePic = null;
        try { profilePic = await contact.getProfilePicUrl(); } catch { /* no pic */ }

        // Store contact name, real number + pic in history record
        const rec = getRecord(senderNumber);
        if (!rec.manualName) rec.name = name; // don't overwrite manually set names
        rec.realNumber = realNumber;
        rec.waId       = message.from; // full WhatsApp ID e.g. 255...@lid or @c.us
        rec.profilePic = profilePic || rec.profilePic || null;
        saveHistory();

        // Notify dashboard of updated conversation
        io.emit('conversation_updated');

        // Auto-reply — debounced: if multiple messages arrive within 3s, reply only to the last one
        if (!isPaused(senderNumber)) {
            lastMessages.set(senderNumber, { text: userText, message });

            if (replyTimers.has(senderNumber)) clearTimeout(replyTimers.get(senderNumber));

            const timer = setTimeout(async () => {
                replyTimers.delete(senderNumber);
                const latest = lastMessages.get(senderNumber);
                lastMessages.delete(senderNumber);
                if (!latest) return;

                try {
                    const reply = await getAIResponse(latest.text, getHistory(senderNumber), getCustomerProfile(senderNumber));
                    const chat  = await latest.message.getChat();
                    await chat.sendStateTyping();
                    await new Promise(r => setTimeout(r, TYPING_DELAY));
                    await latest.message.reply(reply);
                    await chat.clearState();
                    // NOTE: addToHistory for bot replies is handled by message_create event
                    console.log(`[AUTO-REPLY] To ${senderNumber}: ${reply.substring(0, 80)}...`);
                } catch (e) { console.error('[AutoReply]', e.message); }
            }, 3000); // wait 3s for burst messages to settle

            replyTimers.set(senderNumber, timer);
        }

    } catch (err) {
        console.error('[Error]', err.message);
    }
});

client.on('disconnected', (reason) => {
    botStatus = 'connecting';
    io.emit('bot_status', { status: 'connecting' });
    console.log('⚠️  Disconnected:', reason, '— reconnecting...');
    client.initialize();
});

// ── RAG auto-reload ───────────────────────────────────────────────────────────
function triggerRagReload() {
    const RAG_SERVER_URL = process.env.RAG_SERVER_URL || 'http://localhost:8000';
    axios.post(`${RAG_SERVER_URL}/reload`).then(() => {
        console.log('[RAG] Re-indexing triggered');
    }).catch(e => {
        console.warn('[RAG] Could not trigger reload (server may be down):', e.message);
    });
}

// ── REST API ──────────────────────────────────────────────────────────────────

// All conversations sorted by last activity — one entry per contact
app.get('/api/conversations', (req, res) => {
    const result = [];
    for (const [id, rec] of conversationHistory.entries()) {
        result.push({
            id,
            name:         rec.name || id,
            realNumber:   rec.realNumber || null,
            profilePic:   rec.profilePic || null,
            messages:     rec.messages || [],
            lastActivity: rec.lastActivity || 0,
            unread:       rec.unread || 0
        });
    }
    result.sort((a, b) => b.lastActivity - a.lastActivity);
    res.json(result);
});

// Generate 3 reply suggestions for a contact — passes full profile (#3,#5,#7,#8,#9)
app.post('/api/suggestions', async (req, res) => {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'Missing contactId' });
    try {
        const history = getHistory(contactId);
        const lastMsg = history.filter(m => m.role === 'user').pop();
        if (!lastMsg) return res.json({ suggestions: ['How can I help you?', 'Sure, let me check that for you.', 'Thanks for reaching out!'] });
        const profile     = getCustomerProfile(contactId);
        const suggestions = await getSugges