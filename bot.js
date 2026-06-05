/**
 * WhatsApp Personal Bot
 * Features: RAG + Ollama AI, conversation history (persisted), history TTL,
 *           media handling (images/PDFs/docs), human takeover, bot pause/play commands
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode   = require('qrcode-terminal');
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const { getAIResponse } = require('./rag');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME        = process.env.BOT_NAME        || 'WhatsApp Brain';
const TYPING_DELAY    = parseInt(process.env.TYPING_DELAY) || 2000;
const ALLOWED_NUMS    = process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];
const HISTORY_TTL_MS  = parseInt(process.env.HISTORY_TTL_HOURS  || '48')  * 60 * 60 * 1000;
const TAKEOVER_TTL_MS = parseInt(process.env.TAKEOVER_MINUTES   || '30')  * 60 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3.2';

// ── Persistence ───────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'conversation_history.json');
const MAX_HISTORY  = 20;

/**
 * Stored shape per contact:
 * { messages: [{role, content, ts}], lastActivity: <timestamp> }
 */
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            const map = new Map();
            for (const [sender, value] of Object.entries(raw)) {
                // Migrate old format: plain array → new shape
                if (Array.isArray(value)) {
                    map.set(sender, {
                        messages: value.map(m => ({ ...m, ts: m.ts || Date.now() })),
                        lastActivity: Date.now()
                    });
                } else {
                    map.set(sender, value);
                }
            }
            return map;
        }
    } catch { /* ignore corrupt file */ }
    return new Map();
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(Object.fromEntries(conversationHistory)), 'utf8');
    } catch (e) { console.error('[History] Save failed:', e.message); }
}

const conversationHistory = loadHistory();
console.log(`[History] Loaded history for ${conversationHistory.size} contact(s)`);

function getRecord(sender) {
    if (!conversationHistory.has(sender))
        conversationHistory.set(sender, { messages: [], lastActivity: Date.now() });
    return conversationHistory.get(sender);
}

function getHistory(sender) {
    const rec = getRecord(sender);
    // Prune stale history older than TTL
    const cutoff = Date.now() - HISTORY_TTL_MS;
    if (rec.lastActivity < cutoff) {
        console.log(`[History] Expired history for ${sender} (inactive > ${HISTORY_TTL_MS / 3600000}h)`);
        rec.messages = [];
    }
    return rec.messages.map(m => ({ role: m.role, content: m.content }));
}

function addToHistory(sender, role, content) {
    const rec = getRecord(sender);
    rec.messages.push({ role, content, ts: Date.now() });
    rec.lastActivity = Date.now();
    if (rec.messages.length > MAX_HISTORY)
        rec.messages.splice(0, rec.messages.length - MAX_HISTORY);
    saveHistory();
}

// ── Pause / Takeover state ────────────────────────────────────────────────────
// pausedContacts: Map<senderNumber, expiresAt>  — bot won't auto-reply until expiry
const pausedContacts = new Map();
// Global pause — !pause all / !play all
let globalPaused = false;

function isPaused(sender) {
    if (globalPaused) return true;
    const exp = pausedContacts.get(sender);
    if (!exp) return false;
    if (Date.now() > exp) { pausedContacts.delete(sender); return false; }
    return true;
}

// ── Dedup ─────────────────────────────────────────────────────────────────────
const processedMessages = new Set();

// ── Media helpers ─────────────────────────────────────────────────────────────

// Lazy-load optional packages
function tryRequire(pkg) {
    try { return require(pkg); } catch { return null; }
}

/**
 * Ask Ollama vision model to describe an image (base64).
 * Falls back gracefully if no vision model is available.
 */
async function describeImageWithVision(base64Data, mime) {
    const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';
    try {
        const resp = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: VISION_MODEL,
            messages: [{
                role: 'user',
                content: 'Describe this image in detail. What does it show? If it contains text, extract it.',
                images: [base64Data]
            }],
            stream: false
        }, { timeout: 60000 });
        const description = resp.data.message?.content || '';
        console.log('[Vision] Image described via', VISION_MODEL);
        return `[Customer sent an image. Contents: ${description}]`;
    } catch (e) {
        console.warn('[Vision] Vision model unavailable:', e.message);
        return `[Customer sent an image (${mime}) but vision model is not available. Ask them to describe it in text.]`;
    }
}

/**
 * Extract text from PDF buffer using pdf-parse.
 */
async function extractPdfText(buffer) {
    const pdfParse = tryRequire('pdf-parse');
    if (!pdfParse) return null;
    try {
        const data = await pdfParse(buffer);
        return data.text?.trim().substring(0, 3000) || null; // cap at 3000 chars
    } catch (e) {
        console.warn('[PDF] Extraction failed:', e.message);
        return null;
    }
}

/**
 * Extract text from Word doc buffer using mammoth.
 */
async function extractDocxText(buffer) {
    const mammoth = tryRequire('mammoth');
    if (!mammoth) return null;
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value?.trim().substring(0, 3000) || null;
    } catch (e) {
        console.warn('[DOCX] Extraction failed:', e.message);
        return null;
    }
}

/**
 * Download media and return a text prompt describing or containing its content.
 */
async function describeMedia(message) {
    try {
        const media = await message.downloadMedia();
        if (!media) return null;

        const mime  = media.mimetype || '';
        const buf   = Buffer.from(media.data, 'base64');

        // ── Images: use vision model ──────────────────────────────────────────
        if (mime.startsWith('image/')) {
            return await describeImageWithVision(media.data, mime);
        }

        // ── PDFs ──────────────────────────────────────────────────────────────
        if (mime.includes('pdf')) {
            const text = await extractPdfText(buf);
            if (text) return `[Customer sent a PDF. Contents:\n${text}\n\nAnswer their question based on this document.]`;
            return `[Customer sent a PDF but text extraction failed. Ask them to paste the relevant text.]`;
        }

        // ── Word docs ─────────────────────────────────────────────────────────
        if (mime.includes('word') || mime.includes('officedocument.wordprocessingml')) {
            const text = await extractDocxText(buf);
            if (text) return `[Customer sent a Word document. Contents:\n${text}\n\nAnswer their question based on this document.]`;
            return `[Customer sent a Word doc but extraction failed. Ask them to paste the relevant text.]`;
        }

        // ── Plain text ────────────────────────────────────────────────────────
        if (mime.startsWith('text/')) {
            const text = buf.toString('utf8').substring(0, 3000);
            return `[Customer sent a text file. Contents:\n${text}]`;
        }

        // ── Audio ─────────────────────────────────────────────────────────────
        if (mime.startsWith('audio/')) {
            return `[Customer sent a voice/audio message. Let them know you can't process audio yet and ask them to type their question.]`;
        }

        // ── Video ─────────────────────────────────────────────────────────────
        if (mime.startsWith('video/')) {
            return `[Customer sent a video. Acknowledge and ask them to describe what they need.]`;
        }

        return `[Customer sent a file (${mime}). Acknowledge receipt and ask how you can help.]`;
    } catch (e) {
        console.error('[Media] Failed:', e.message);
        return null;
    }
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-brain' }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'
        ]
    }
});

// ── Events ────────────────────────────────────────────────────────────────────

client.on('qr', (qr) => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║     Scan this QR code with WhatsApp      ║');
    console.log('║  Open WhatsApp → Settings → Linked Devices ║');
    console.log('╚══════════════════════════════════════════╝\n');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ WhatsApp authenticated!'));
client.on('auth_failure',  (msg) => console.error('❌ Auth failed:', msg));

client.on('ready', () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log(`║  ${BOT_NAME} is LIVE on your personal number  ║`);
    console.log('╚══════════════════════════════════════════╝\n');
    console.log('[Config] Allowed numbers:', ALLOWED_NUMS.length ? ALLOWED_NUMS.join(', ') : 'ALL');
    console.log('[Config] History TTL:', HISTORY_TTL_MS / 3600000, 'hours');
    console.log('[Config] Takeover TTL:', TAKEOVER_TTL_MS / 60000, 'minutes\n');
    console.log('Commands (send from your own number):');
    console.log('  !pause <number|all>  — stop bot replying to that contact (or all)');
    console.log('  !play <number|all>   — resume bot replies\n');
});

// ── Capture YOUR outgoing messages (message_create fires for sent + received) ──
client.on('message_create', async (message) => {
    if (!message.fromMe) return;
    if (message.isStatus) return;

    const to = (message.to || '').replace(/@c\.us$|@lid$/, '');
    if (!to || message.to?.endsWith('@g.us')) return;

    const text = message.body?.trim();
    if (!text) return;

    // ── Control commands ──────────────────────────────────────────────────────
    if (text.startsWith('!pause')) {
        const target = text.split(' ')[1]?.trim() || '';
        if (target === 'all') {
            globalPaused = true;
            console.log('[Bot] Globally PAUSED');
        } else if (target) {
            pausedContacts.set(target, Date.now() + TAKEOVER_TTL_MS);
            console.log(`[Bot] Paused for ${target} (${TAKEOVER_TTL_MS / 60000} min)`);
        }
        return;
    }

    if (text.startsWith('!play')) {
        const target = text.split(' ')[1]?.trim() || '';
        if (target === 'all') {
            globalPaused = false;
            pausedContacts.clear();
            console.log('[Bot] Globally RESUMED');
        } else if (target) {
            pausedContacts.delete(target);
            console.log(`[Bot] Resumed for ${target}`);
        }
        return;
    }

    // ── Store your manual reply as assistant context ───────────────────────────
    addToHistory(to, 'assistant', text);
    // Auto-pause that contact for TAKEOVER_TTL_MS since you're manually replying
    pausedContacts.set(to, Date.now() + TAKEOVER_TTL_MS);
    console.log(`[History] Saved your reply to ${to} | Auto-paused bot for ${TAKEOVER_TTL_MS / 60000} min`);
});

// ── Incoming messages ─────────────────────────────────────────────────────────
client.on('message', async (message) => {
    try {
        if (processedMessages.has(message.id._serialized)) return;
        processedMessages.add(message.id._serialized);

        if (message.isStatus || message.fromMe) return;
        if (message.from.endsWith('@g.us')) return;

        const senderNumber = message.from.replace(/@c\.us$|@lid$/, '');

        if (ALLOWED_NUMS.length > 0 && !ALLOWED_NUMS.includes(senderNumber)) {
            console.log(`[Skip] ${senderNumber} not in allowed list`);
            return;
        }

        // Resolve message content — text or media
        let userText = message.body?.trim();

        if (!userText && message.hasMedia) {
            userText = await describeMedia(message);
        }

        if (!userText) return;

        console.log(`[MSG] From ${senderNumber}: ${userText.substring(0, 100)}`);

        // Store incoming message
        addToHistory(senderNumber, 'user', userText);

        // Skip AI reply if paused (human takeover active)
        if (isPaused(senderNumber)) {
            console.log(`[Skip] Bot paused for ${senderNumber}`);
            return;
        }

        // Typing indicator + delay
        const chat = await message.getChat();
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, TYPING_DELAY));

        // AI response
        const reply = await getAIResponse(userText, getHistory(senderNumber));

        await chat.clearState();
        await message.reply(reply);

        addToHistory(senderNumber, 'assistant', reply);
        console.log(`[REPLY] To ${senderNumber}: ${reply.substring(0, 80)}...`);

    } catch (err) {
        console.error('[Error]', err.message);
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️  Disconnected:', reason, '— reconnecting...');
    client.initialize();
});

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('\nStarting WhatsApp Personal Bot...');

(async () => {
    try {
        console.log(`[Warmup] Loading ${OLLAMA_MODEL} into memory...`);
        await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: OLLAMA_MODEL,
            messages: [{ role: 'user', content: 'hi' }],
            stream: false
        }, { timeout: 120000 });
        console.log('[Warmup] Ollama model ready ✅');
    } catch (e) {
        console.log('[Warmup] Could not pre-load model:', e.message);
    }
})();

client.initialize();
