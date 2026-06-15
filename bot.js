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
const { execSync } = require('child_process');
const { getAIResponse, getSuggestions, sendCorrection, summarizeHistory, warmupOllama } = require('./rag');
require('dotenv').config();

// Kill stale Chrome AND any node process holding port 3001
try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
try {
    // find PID on port 3001 and kill it (avoids EADDRINUSE on restart)
    const out = execSync('netstat -ano -p TCP 2>nul', { stdio: ['ignore','pipe','ignore'] }).toString();
    const match = out.split('\n').find(l => l.includes(':3001') && l.includes('LISTENING'));
    if (match) {
        const pid = match.trim().split(/\s+/).at(-1);
        if (pid && pid !== process.pid.toString()) execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore' });
    }
} catch {}
console.log('[Boot] Cleared stale processes');

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME        = process.env.BOT_NAME          || 'WhatsApp Brain';
const TYPING_DELAY    = parseInt(process.env.TYPING_DELAY)      || 2000;
const ALLOWED_NUMS    = process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];
const HISTORY_TTL_MS  = parseInt(process.env.HISTORY_TTL_HOURS || '48') * 60 * 60 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL      || 'llama3.2';
const PORT            = parseInt(process.env.DASHBOARD_PORT || process.env.PORT) || 3001;

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// ── Persistence ───────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'conversation_history.json');
const MAX_HISTORY  = 200;

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

function addToHistory(sender, role, content, media = null) {
    const rec   = getRecord(sender);
    const entry = { role, content, ts: Date.now() };
    if (media) entry.media = media;
    rec.messages.push(entry);
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

// ── Paths ─────────────────────────────────────────────────────────────────────
const DOCS_DIR     = path.join(__dirname, 'docs');
const PROFILE_FILE = path.join(DOCS_DIR, 'company_info.txt');
const MEDIA_DIR    = path.join(__dirname, 'media');
if (!fs.existsSync(DOCS_DIR))  fs.mkdirSync(DOCS_DIR,  { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ── State ─────────────────────────────────────────────────────────────────────
const processedMessages = new Set();
const recentIncoming    = new Map(); // dedup: "sender:content" → timestamp (catches @c.us vs @lid)
const pausedContacts    = new Map();
const replyTimers       = new Map(); // debounce: contactId → setTimeout handle
const pendingQueues     = new Map(); // queue: contactId → [{text, message}]
const recentApiReplies  = new Map(); // dedup: skip message_create for API-sent replies
let   globalPaused      = true; // semi-auto: bot never auto-replies, use dashboard to send
let   botStatus         = 'connecting';

// Serialise all AI calls so Ollama only ever gets one request at a time.
// _aiQueueDepth > 0 means at least one call is queued or running.
let _aiQueue      = Promise.resolve();
let _aiQueueDepth = 0;

function queueAI(fn) {
    _aiQueueDepth++;
    // .then(successFn, failFn) runs exactly once regardless of previous result — no double-call
    const task    = _aiQueue.then(() => fn(), () => fn());
    _aiQueue      = task.then(() => { _aiQueueDepth--; }, () => { _aiQueueDepth--; });
    return task;
}

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
        return `[Image]`;
    }
}

async function describeMedia(message) {
    // Declare outside try so the catch can still return a saved mediaInfo
    let mediaInfo = null;
    try {
        const media = await message.downloadMedia();
        if (!media) return { text: null, mediaInfo: null };
        const mime = media.mimetype || '';
        const buf  = Buffer.from(media.data, 'base64');

        // Save images and PDFs to disk for dashboard display
        if (mime.startsWith('image/') || mime.includes('pdf')) {
            try {
                const ext      = mime.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'bin';
                const safeid   = message.id._serialized.replace(/[^a-z0-9_-]/gi, '_');
                const filename = `${safeid}.${ext}`;
                const origName = media.filename || filename;
                fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);
                mediaInfo = { filename, origName, mimeType: mime, type: mime.startsWith('image/') ? 'image' : 'pdf' };
                console.log(`[Media] Saved ${mediaInfo.type}: ${origName}`);
            } catch (e) { console.warn('[Media] Save failed:', e.message); }
        }

        if (mime.startsWith('image/'))
            return { text: await describeImageWithVision(media.data, mime), mediaInfo };

        if (mime.includes('pdf')) {
            try {
                const pdfParse = tryRequire('pdf-parse');
                if (pdfParse) {
                    const data = await pdfParse(buf);
                    const text = data.text?.trim().substring(0, 3000);
                    if (text) return { text: `[Customer sent a PDF. Contents:\n${text}]`, mediaInfo };
                }
            } catch (e) { console.warn('[Media] pdf-parse failed:', e.message); }
            return { text: `[PDF]`, mediaInfo };
        }

        if (mime.includes('word') || mime.includes('wordprocessingml')) {
            const mammoth = tryRequire('mammoth');
            if (mammoth) {
                const result = await mammoth.extractRawText({ buffer: buf });
                const text = result.value?.trim().substring(0, 3000);
                if (text) return { text: `[Customer sent a Word document. Contents:\n${text}]`, mediaInfo };
            }
            return { text: `[Customer sent a Word doc.]`, mediaInfo };
        }

        if (mime.startsWith('text/'))
            return { text: `[Customer sent a text file:\n${buf.toString('utf8').substring(0, 3000)}]`, mediaInfo: null };

        if (mime.startsWith('audio/'))
            return { text: `[Customer sent a voice/audio message.]`, mediaInfo: null };

        if (mime.startsWith('video/'))
            return { text: `[Customer sent a video.]`, mediaInfo: null };

        return { text: `[Customer sent a file (${mime}).]`, mediaInfo: null };
    } catch (e) {
        console.error('[Media] Failed:', e.message);
        return { text: null, mediaInfo }; // return whatever was saved before the error
    }
}

// Download & save an image/PDF from a Message object — no AI, just file save.
// Skips if already saved. Returns mediaInfo or null.
async function saveMediaFromMsg(msg) {
    try {
        if (!msg.hasMedia || !['image', 'document'].includes(msg.type)) return null;
        const downloaded = await msg.downloadMedia();
        if (!downloaded) return null;
        const mime = downloaded.mimetype || '';
        if (!mime.startsWith('image/') && !mime.includes('pdf')) return null;
        const ext      = mime.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'bin';
        const safeid   = msg.id._serialized.replace(/[^a-z0-9_-]/gi, '_');
        const filename = `${safeid}.${ext}`;
        const filepath = path.join(MEDIA_DIR, filename);
        if (!fs.existsSync(filepath))
            fs.writeFileSync(filepath, Buffer.from(downloaded.data, 'base64'));
        return { filename, origName: downloaded.filename || filename, mimeType: mime,
                 type: mime.startsWith('image/') ? 'image' : 'pdf' };
    } catch { return null; }
}

// ── Seed history from WhatsApp ────────────────────────────────────────────────
/**
 * When a contact messages for the first time after a fresh bot start,
 * fetch their last 20 messages from WhatsApp and seed the history.
 */
async function seedHistoryFromWhatsApp(message, senderNumber) {
    try {
        const chat = await message.getChat();
        const past = await chat.fetchMessages({ limit: 200 });
        if (!past || past.length === 0) return;

        const rec = getRecord(senderNumber);
        const seeded = [];

        for (const msg of past) {
            if (msg.isStatus) continue;
            // Skip the current message itself (we'll add it via addToHistory)
            if (msg.id._serialized === message.id._serialized) continue;
            const body = msg.body?.trim() || '';
            if (!body && !msg.hasMedia) continue;

            let mediaInfo = null;
            if (msg.hasMedia) mediaInfo = await saveMediaFromMsg(msg);

            let content = body;
            if (!content && mediaInfo)
                content = mediaInfo.type === 'image' ? '[Image]' : `[PDF: ${mediaInfo.origName}]`;
            if (!content) continue;

            const entry = { role: msg.fromMe ? 'assistant' : 'user', content, ts: msg.timestamp * 1000 };
            if (mediaInfo) entry.media = mediaInfo;
            seeded.push(entry);
        }

        if (seeded.length > 0) {
            seeded.sort((a, b) => a.ts - b.ts);
            rec.messages = seeded.slice(-200);
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
               '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'],
        protocolTimeout: 120000
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

    // Fix 3: pre-warm Ollama so model is loaded before first real message
    warmupOllama();

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

                const msgs = await chat.fetchMessages({ limit: 200 });
                if (!msgs || msgs.length === 0) continue;

                // Build message history — include images & PDFs
                const raw = [];
                for (const m of msgs) {
                    if (m.isStatus) continue;
                    const body = m.body?.trim() || '';
                    if (!body && !m.hasMedia) continue;

                    let mediaInfo = null;
                    if (m.hasMedia) mediaInfo = await saveMediaFromMsg(m);

                    let content = body;
                    if (!content && mediaInfo)
                        content = mediaInfo.type === 'image' ? '[Image]' : `[PDF: ${mediaInfo.origName}]`;
                    if (!content) continue;

                    const entry = { role: m.fromMe ? 'assistant' : 'user', content, ts: m.timestamp * 1000 };
                    if (mediaInfo) entry.media = mediaInfo;
                    raw.push(entry);
                }
                const seeded = raw.sort((a, b) => a.ts - b.ts).slice(-200);

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
    if (!message.fromMe || message.isStatus) return;
    if (processedMessages.has(message.id._serialized)) return;
    processedMessages.add(message.id._serialized);
    // Secondary dedup: same recipient+content within 10s catches all @suffix variants
    const outKey = `${(message.to || '').replace(/@.*$/, '')}:${(message.body || '').slice(0, 100)}`;
    const lastOut = recentApiReplies.get(`out:${outKey}`);
    if (lastOut && Date.now() - lastOut < 10000) return;
    recentApiReplies.set(`out:${outKey}`, Date.now());
    setTimeout(() => recentApiReplies.delete(`out:${outKey}`), 10000);
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
        // Secondary dedup: same sender+content within 15s catches @c.us vs @lid duplicates
        const senderRaw = (message.from || '').replace(/@c\.us$|@lid$/, '');
        const incomingKey = `${senderRaw}:${(message.body || '').slice(0, 100)}`;
        const lastSeen = recentIncoming.get(incomingKey);
        if (lastSeen && Date.now() - lastSeen < 15000) return;
        recentIncoming.set(incomingKey, Date.now());
        setTimeout(() => recentIncoming.delete(incomingKey), 15000);
        if (message.from.endsWith('@g.us') || message.from.endsWith('@newsletter')) return;

        const senderNumber = message.from.replace(/@c\.us$|@lid$/, '');
        if (ALLOWED_NUMS.length > 0 && !ALLOWED_NUMS.includes(senderNumber)) return;

        let userText  = message.body?.trim();
        let mediaInfo = null;
        if (message.hasMedia) {
            const result = await describeMedia(message);
            mediaInfo = result.mediaInfo;
            if (!userText) userText = result.text;
        }
        if (!userText && !mediaInfo) return;
        userText = userText || '';

        console.log(`[MSG] From ${senderNumber}: ${userText.substring(0, 80)}`);

        addToHistory(senderNumber, 'user', userText, mediaInfo);

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

        // Auto-reply — wait 1.5s for burst to settle, then send ONE reply covering all messages
        // Skip if AI queue is already backed up (> 2 pending) to avoid timeout cascade
        if (!isPaused(senderNumber) && _aiQueueDepth < 3) {
            if (!pendingQueues.has(senderNumber)) pendingQueues.set(senderNumber, []);
            pendingQueues.get(senderNumber).push({ text: userText, message });

            if (replyTimers.has(senderNumber)) clearTimeout(replyTimers.get(senderNumber));

            const timer = setTimeout(async () => {
                replyTimers.delete(senderNumber);
                const queue = pendingQueues.get(senderNumber) || [];
                pendingQueues.delete(senderNumber);
                if (queue.length === 0) return;

                // Combine all burst messages into one question so one AI call handles them all
                const combined = queue.length === 1
                    ? queue[0].text
                    : queue.map(m => m.text).join('\n');
                const lastItem = queue[queue.length - 1]; // reply to the last message in the burst

                try {
                    const reply = await queueAI(() =>
                        getAIResponse(combined, getHistory(senderNumber), getCustomerProfile(senderNumber))
                    );
                    if (!reply) return;
                    const chat = await lastItem.message.getChat();
                    try { await chat.sendStateTyping(); } catch {}
                    await new Promise(r => setTimeout(r, Math.min(reply.length * 20, 1500)));
                    await lastItem.message.reply(reply);
                    try { await chat.clearState(); } catch {}
                    console.log(`[AUTO-REPLY] To ${senderNumber} (${queue.length} msg): ${reply.substring(0, 80)}...`);
                } catch (e) { console.error('[AutoReply]', e.message); }
            }, 1500);

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
    }).catch(() => {}); // RAG server is optional — silence error when not running
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
            lastActivity: rec.lastActivity || (rec.messages || []).at(-1)?.ts || 0,
            unread:       rec.unread || 0
        });
    }
    result.sort((a, b) => b.lastActivity - a.lastActivity);
    res.json(result);
});

const DEFAULT_SUGGESTIONS = [
    "Got it! I'll get back to you shortly.",
    "Sure, happy to help! What do you need?",
    "Thanks for reaching out. Let me look into that for you.",
];

// contactId → Promise<string[]>  — deduplicates concurrent suggestion requests
const suggestionInProgress = new Map();

// Generate 3 reply suggestions for a contact
app.post('/api/suggestions', async (req, res) => {
    const { contactId, filterMs } = req.body;
    if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

    // If auto-reply is queued/running, skip — avoids competing with the reply queue
    if (_aiQueueDepth > 0 || replyTimers.size > 0) {
        return res.json({ suggestions: DEFAULT_SUGGESTIONS });
    }

    // If Ollama is already generating suggestions for this contact (e.g. auto-trigger
    // fired and user also clicked the button), share the same promise instead of
    // queuing a second Ollama call which would double the wait time and cause a timeout.
    if (suggestionInProgress.has(contactId)) {
        console.log(`[Suggestions] Joining in-progress fetch for ${contactId}`);
        try {
            const suggestions = await suggestionInProgress.get(contactId);
            return res.json({ suggestions });
        } catch {
            return res.json({ suggestions: DEFAULT_SUGGESTIONS });
        }
    }

    try {
        let history = getHistory(contactId);
        if (filterMs) {
            const cutoff = Date.now() - parseInt(filterMs);
            const rec = getRecord(contactId);
            history = (rec.messages || [])
                .filter(m => { const ts = m.ts < 1e12 ? m.ts * 1000 : m.ts; return ts >= cutoff; })
                .map(m => ({ role: m.role, content: m.content }));
        }
        const lastMsg = history.filter(m => m.role === 'user').pop();
        if (!lastMsg) return res.json({ suggestions: DEFAULT_SUGGESTIONS });

        const profile = getCustomerProfile(contactId);
        const promise = getSuggestions(lastMsg.content, history, profile)
            .catch(() => DEFAULT_SUGGESTIONS);
        suggestionInProgress.set(contactId, promise);

        const suggestions = await promise;
        res.json({ suggestions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        suggestionInProgress.delete(contactId);
    }
});

// Send a manual reply via WhatsApp
app.post('/api/reply', async (req, res) => {
    const { text, to } = req.body;
    if (!text || !to) return res.status(400).json({ error: 'Missing text or to' });
    try {
        const rec       = conversationHistory.get(to);
        const waId      = rec?.waId || (to.includes('@') ? to : `${to}@c.us`);
        const chat      = await client.getChatById(waId);
        const senderNum = to.replace(/@.*$/, '');

        // Set dedup key BEFORE sendMessage — message_create fires during/before the await resolves
        const outKey = `${senderNum}:${text.slice(0, 100)}`;
        recentApiReplies.set(`out:${outKey}`, Date.now());
        setTimeout(() => recentApiReplies.delete(`out:${outKey}`), 10000);

        try { await chat.sendStateTyping(); } catch {}
        await new Promise(r => setTimeout(r, Math.min(text.length * 30, 2000)));
        await chat.sendMessage(text);
        try { await chat.clearState(); } catch {}

        addToHistory(senderNum, 'assistant', text);
        io.emit('conversation_updated');
        console.log(`[API] Reply sent to ${to}: ${text.substring(0, 60)}`);
        res.json({ success: true });
    } catch (e) {
        console.error('[API Reply Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Rename a contact
app.post('/api/rename', (req, res) => {
    const { contactId, name } = req.body;
    if (!contactId || !name) return res.status(400).json({ error: 'Missing contactId or name' });
    const rec = getRecord(contactId);
    rec.name       = name.trim();
    rec.manualName = true;
    saveHistory();
    io.emit('conversation_updated');
    res.json({ success: true });
});

// Get / save bot profile (stored as plain text in profile.txt)
app.get('/api/profile', (req, res) => {
    try {
        const content = fs.existsSync(PROFILE_FILE) ? fs.readFileSync(PROFILE_FILE, 'utf8') : '';
        res.json({ content, settings: {} });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'Missing content' });
    try {
        fs.writeFileSync(PROFILE_FILE, content, 'utf8');
        triggerRagReload();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// List docs
app.get('/api/docs', (req, res) => {
    try {
        const files = fs.readdirSync(DOCS_DIR).map(name => {
            const stat = fs.statSync(path.join(DOCS_DIR, name));
            return { name, size: stat.size, modified: stat.mtimeMs };
        });
        res.json(files);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload a doc (base64 encoded)
app.post('/api/docs/upload', (req, res) => {
    const { filename, data } = req.body;
    if (!filename || !data) return res.status(400).json({ error: 'Missing filename or data' });
    try {
        const buf = Buffer.from(data, 'base64');
        fs.writeFileSync(path.join(DOCS_DIR, path.basename(filename)), buf);
        triggerRagReload();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a doc
app.delete('/api/docs/:name', (req, res) => {
    try {
        const file = path.join(DOCS_DIR, path.basename(req.params.name));
        if (fs.existsSync(file)) fs.unlinkSync(file);
        triggerRagReload();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crawl a website URL using Puppeteer (handles React/SPA sites) and save content as a doc
// Clicks every nav/menu item and expands all accordions to capture full content
app.post('/api/docs/crawl', async (req, res) => {
    const { url, maxPages = 10 } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    let baseUrl;
    try { baseUrl = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

    const puppeteer = require('puppeteer-core');
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });

        const visited  = new Set();
        const queue    = [url];
        const sections = []; // { label, text }

        // Words that indicate action buttons, not nav/section items
        const ACTION_WORDS = new Set([
            'plot','simulate','fetch','download csv','remove','add stock','+ add stock',
            '+ add ticker','add holding','+ add holding','load chart','load gold view',
            'load','send','show','hide','compare','weekly','monthly','weeklymonthly',
            'fixed $/month','% of portfolio/month','fixed $/monthopen',
            '% of portfolio/monthopen','load gold view','add holding','+ add stock',
        ]);

        // Extract visible text using a DOM clone — does NOT modify the live page
        const extractText = (page) => page.evaluate(() => {
            const clone = document.body?.cloneNode(true);
            if (!clone) return '';
            ['script','style','svg','noscript'].forEach(tag =>
                clone.querySelectorAll(tag).forEach(el => el.remove())
            );
            return (clone.innerText || '').replace(/\s+/g, ' ').trim();
        });

        // Find all clickable leaf items (cursor:pointer divs/spans/li — works for SPAs with no nav tag)
        const getClickableItems = (page) => page.evaluate(() => {
            return [...new Set(
                Array.from(document.querySelectorAll('div, span, li'))
                    .filter(el => {
                        if (el.children.length > 0) return false;
                        const text = el.innerText?.trim();
                        if (!text || text.length < 3 || text.length > 60) return false;
                        return window.getComputedStyle(el).cursor === 'pointer';
                    })
                    .map(el => el.innerText?.trim())
            )];
        });

        // Click a specific item by matching its visible text
        const clickItem = (page, text) => page.evaluate((t) => {
            const el = Array.from(document.querySelectorAll('div, span, li'))
                .find(e => e.children.length === 0 && e.innerText?.trim() === t
                        && window.getComputedStyle(e).cursor === 'pointer');
            if (el) { el.click(); return true; }
            return false;
        }, text);

        // Normalize URL: strip hash, query, trailing slash
        const normalizeUrl = (u) => {
            try {
                const p = new URL(u);
                return `${p.protocol}//${p.hostname}${p.pathname}`.replace(/\/$/, '');
            } catch { return u; }
        };

        while (queue.length > 0 && visited.size < maxPages) {
            const current = normalizeUrl(queue.shift());
            if (visited.has(current)) continue;
            visited.add(current);

            const page = await browser.newPage();
            try {
                await page.goto(current, { waitUntil: 'networkidle2', timeout: 25000 });

                // ── Step 1: capture main page content ──
                const mainText = await extractText(page);
                if (mainText.length > 100) {
                    sections.push({ label: current, text: mainText });
                    console.log(`[Crawl] ✓ Main page (${mainText.length} chars)`);
                }

                // ── Step 2: get ALL nav items (clickable + currently-active siblings) ──
                const allNavTexts = await page.evaluate(() => {
                    const clickableEls = Array.from(document.querySelectorAll('div, span, li'))
                        .filter(el => {
                            if (el.children.length > 0) return false;
                            const text = el.innerText?.trim();
                            if (!text || text.length < 3 || text.length > 60) return false;
                            return window.getComputedStyle(el).cursor === 'pointer';
                        });
                    const all = new Set(clickableEls.map(e => e.innerText?.trim()));
                    // Include siblings of clickable items (the currently-active nav item has cursor:default)
                    new Set(clickableEls.map(e => e.parentElement).filter(Boolean))
                        .forEach(parent => Array.from(parent.children).forEach(child => {
                            if (child.children.length === 0) {
                                const t = child.innerText?.trim();
                                if (t && t.length >= 3 && t.length <= 60) all.add(t);
                            }
                        }));
                    return [...all];
                });
                const navSet      = new Set(allNavTexts); // complete nav set including active item
                const navItems    = allNavTexts.filter(t => !ACTION_WORDS.has(t.toLowerCase()));
                console.log(`[Crawl] Nav items: ${navItems.join(', ')}`);

                // ── Step 3: click each nav item → save section → find & click sub-items ──
                for (const navItem of navItems) {
                    try {
                        const clicked = await clickItem(page, navItem);
                        if (!clicked) continue;
                        await new Promise(r => setTimeout(r, 1200));

                        // Always save the nav section content first
                        const navText = await extractText(page);
                        if (navText.length > 100 && navText !== mainText) {
                            sections.push({ label: `${current} › ${navItem}`, text: navText });
                            console.log(`[Crawl] ✓ "${navItem}" (${navText.length} chars)`);
                        }

                        // Find genuinely NEW items — not in the complete nav set (e.g. FAQ accordions)
                        const afterItems = await getClickableItems(page);
                        const subItems = afterItems.filter(t =>
                            !ACTION_WORDS.has(t.toLowerCase()) && !navSet.has(t)
                        );

                        for (const sub of subItems) {
                            const subClicked = await clickItem(page, sub);
                            if (!subClicked) continue;
                            await new Promise(r => setTimeout(r, 500));
                            const subText = await extractText(page);
                            if (subText.length > 100) {
                                sections.push({ label: `${current} › ${navItem} › ${sub}`, text: subText });
                                console.log(`[Crawl] ✓ "${navItem} › ${sub}" (${subText.length} chars)`);
                            }
                        }
                    } catch (e) {
                        console.warn(`[Crawl] Skipped nav "${navItem}":`, e.message);
                    }
                }

                // SPA: all content captured via nav clicking — no need to follow links

            } catch (e) {
                console.warn(`[Crawl] Skipped ${current}:`, e.message);
            } finally {
                await page.close().catch(() => {});
            }
        }

        if (sections.length === 0) return res.status(400).json({ error: 'No content could be fetched — site may be blocking crawlers' });

        // Deduplicate by label (each section has a unique label)
        const seen   = new Set();
        const unique = sections.filter(s => {
            if (seen.has(s.label)) return false;
            seen.add(s.label);
            return true;
        });

        const domain   = baseUrl.hostname.replace(/[^a-z0-9]/gi, '_');
        const content  = unique.map(s => `=== ${s.label} ===\n${s.text}`).join('\n\n');
        const filename = `website_${domain}.txt`;
        fs.writeFileSync(path.join(DOCS_DIR, filename), content, 'utf8');
        triggerRagReload();
        console.log(`[Crawl] Saved ${unique.length} section(s) → ${filename} (${content.length} chars)`);
        res.json({ success: true, pages: unique.length, filename });

    } catch (e) {
        console.error('[Crawl] Error:', e.message);
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

// Save RAG correction (correction learning #8)
app.post('/api/feedback', async (req, res) => {
    const { question, original, corrected } = req.body;
    if (!question || !original || !corrected) return res.status(400).json({ error: 'Missing fields' });
    try {
        await sendCorrection(question, original, corrected);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pause / resume auto-reply
app.post('/api/pause', (req, res) => {
    const { target } = req.body;
    if (target === 'all') { globalPaused = true; }
    else if (target)      { pausedContacts.set(target, Infinity); }
    io.emit('pause_changed', { globalPaused });
    res.json({ success: true });
});

app.post('/api/play', (req, res) => {
    const { target } = req.body;
    if (target === 'all') {
        globalPaused = false;
        pausedContacts.clear();

        // Retroactively reply to unanswered messages from the last 30 minutes
        const now = Date.now();
        const MAX_AGE_MS = 30 * 60 * 1000;
        for (const [senderNum, rec] of conversationHistory.entries()) {
            if (!rec.messages || rec.messages.length === 0 || !rec.waId) continue;
            const lastMsg = rec.messages[rec.messages.length - 1];
            if (lastMsg.role !== 'user') continue;
            const msgTs = lastMsg.ts < 1e12 ? lastMsg.ts * 1000 : lastMsg.ts;
            if (now - msgTs > MAX_AGE_MS) continue;
            const waId    = rec.waId;
            const userTxt = lastMsg.content;
            queueAI(async () => {
                try {
                    const reply = await getAIResponse(userTxt, getHistory(senderNum), getCustomerProfile(senderNum));
                    if (!reply) return;
                    const outKey = `${senderNum}:${reply.slice(0, 100)}`;
                    recentApiReplies.set(`out:${outKey}`, Date.now());
                    setTimeout(() => recentApiReplies.delete(`out:${outKey}`), 10000);
                    await client.sendMessage(waId, reply);
                    addToHistory(senderNum, 'assistant', reply);
                    io.emit('conversation_updated');
                    console.log(`[RESUME-REPLY] To ${senderNum}: ${reply.substring(0, 80)}...`);
                } catch (e) { console.error('[ResumeReply]', e.message); }
            });
        }
    } else if (target) {
        pausedContacts.delete(target);
    }
    io.emit('pause_changed', { globalPaused });
    res.json({ success: true });
});

// Bot status
app.get('/api/status', (req, res) => {
    res.json({ status: botStatus, globalPaused });
});

// Logout from WhatsApp (clears session — next start will show QR)
app.post('/api/logout', async (req, res) => {
    res.json({ success: true });
    botStatus = 'connecting';
    io.emit('bot_status', { status: botStatus });
    try {
        await client.logout();
        await client.destroy();
    } catch (e) {
        console.warn('[Logout]', e.message);
    }
    console.log('[WhatsApp] Logged out — restarting for QR…');
    setTimeout(() => startWhatsApp(), 2000);
});

// Serve saved media files (images, PDFs)
app.get('/api/media/:filename', (req, res) => {
    const file = path.join(MEDIA_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(file)) return res.status(404).send('Not found');
    res.sendFile(file);
});

// SPA catch-all
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('[Dashboard] Browser connected');
    socket.emit('init_state', { status: botStatus, globalPaused });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function startWhatsApp() {
    try {
        await client.initialize();
    } catch (err) {
        console.error('[WhatsApp] Crash:', err.message);
        console.log('[WhatsApp] Restarting in 5s...');
        try { await client.destroy(); } catch {}
        try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
        setTimeout(() => startWhatsApp(), 5000);
    }
}

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    if (msg.includes('ProtocolError') || msg.includes('Execution context') ||
        msg.includes('auth timeout') || msg.includes('timed out')) {
        console.warn('[WhatsApp] Recoverable error — restarting in 5s:', msg);
        try { client.destroy(); } catch {}
        try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
        setTimeout(() => startWhatsApp(), 5000);
    } else {
        console.error('[UnhandledRejection]', reason);
    }
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Dashboard] Port ${PORT} still in use. Kill the old process and retry.`);
    } else {
        console.error('[Dashboard] Server error:', err.message);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`[Dashboard] Running at http://localhost:${PORT}`);
});

startWhatsApp();