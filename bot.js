/**
 * WhatsApp Personal Bot — Dashboard Mode
 * Instead of auto-replying, generates 3 AI suggestions and shows them in the web dashboard.
 * User picks one (or types custom) and sends it from the dashboard.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const fs        = require('fs');
const path      = require('path');
const axios     = require('axios');
const express   = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');
const { getAIResponse, getSuggestions } = require('./rag');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME        = process.env.BOT_NAME        || 'WhatsApp Brain';
const TYPING_DELAY    = parseInt(process.env.TYPING_DELAY)    || 2000;
const ALLOWED_NUMS    = process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];
const HISTORY_TTL_MS  = parseInt(process.env.HISTORY_TTL_HOURS  || '48') * 60 * 60 * 1000;
const TAKEOVER_TTL_MS = parseInt(process.env.TAKEOVER_MINUTES   || '30') * 60 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3.2';
const DASHBOARD_PORT  = parseInt(process.env.DASHBOARD_PORT)   || 3001;

// ── Persistence ───────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'conversation_history.json');
const MAX_HISTORY  = 20;

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            const map = new Map();
            for (const [sender, value] of Object.entries(raw)) {
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
    const cutoff = Date.now() - HISTORY_TTL_MS;
    if (rec.lastActivity < cutoff) {
        console.log(`[History] Expired history for ${sender}`);
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
const pausedContacts = new Map();
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

// ── Dashboard state ───────────────────────────────────────────────────────────
const pendingMessages = new Map();   // id → pending message object
const recentApiReplies = new Map();  // text → timestamp (to avoid double-storing in history)
let botStatus = 'initializing';

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Serve built frontend in production
const FRONTEND_DIST = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    console.log('[Dashboard] Serving frontend from', FRONTEND_DIST);
}

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
    res.json({
        status: botStatus,
        pendingCount: pendingMessages.size,
        globalPaused,
        historyCount: conversationHistory.size
    });
});

app.get('/api/pending', (req, res) => {
    res.json([...pendingMessages.values()].sort((a, b) => a.ts - b.ts));
});

app.get('/api/conversations', (req, res) => {
    const conversations = [];
    for (const [sender, record] of conversationHistory) {
        conversations.push({
            id: sender,
            messages: record.messages,
            lastActivity: record.lastActivity,
            isPaused: isPaused(sender)
        });
    }
    res.json(conversations.sort((a, b) => b.lastActivity - a.lastActivity));
});

app.post('/api/reply', async (req, res) => {
    const { messageId, text, to } = req.body;
    if (!text || !to) return res.status(400).json({ error: 'Missing text or to' });

    try {
        const chatId = to.includes('@') ? to : `${to}@c.us`;
        const chat = await client.getChatById(chatId);
        await chat.sendMessage(text);

        const senderNum = to.replace(/@c\.us$/, '');
        addToHistory(senderNum, 'assistant', text);

        // Mark as API-sent to avoid double-storing in message_create handler
        recentApiReplies.set(text, Date.now());
        setTimeout(() => recentApiReplies.delete(text), 5000);

        if (messageId) pendingMessages.delete(messageId);

        io.emit('reply_sent', { messageId, to, text, ts: Date.now() });
        console.log(`[API] Reply sent to ${to}: ${text.substring(0, 60)}`);
        res.json({ success: true });
    } catch (e) {
        console.error('[API Reply Error]', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dismiss', (req, res) => {
    const { messageId } = req.body;
    if (messageId) {
        pendingMessages.delete(messageId);
        io.emit('message_dismissed', { messageId });
    }
    res.json({ success: true });
});

app.post('/api/regenerate', async (req, res) => {
    const { messageId } = req.body;
    const pending = pendingMessages.get(messageId);
    if (!pending) return res.status(404).json({ error: 'Message not found' });

    try {
        const suggestions = await getSuggestions(pending.text, getHistory(pending.from));
        pending.suggestions = suggestions;
        io.emit('suggestions_updated', { messageId, suggestions });
        res.json({ success: true, suggestions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/pause', (req, res) => {
    const { target } = req.body;
    if (target === 'all') {
        globalPaused = true;
    } else if (target) {
        pausedContacts.set(target, Date.now() + TAKEOVER_TTL_MS);
    }
    io.emit('pause_changed', { target, paused: true, globalPaused });
    res.json({ success: true });
});

app.post('/api/play', (req, res) => {
    const { target } = req.body;
    if (target === 'all') {
        globalPaused = false;
        pausedContacts.clear();
    } else if (target) {
        pausedContacts.delete(target);
    }
    io.emit('pause_changed', { target, paused: false, globalPaused });
    res.json({ success: true });
});

// Catch-all: serve React SPA for non-API routes in production
if (fs.existsSync(FRONTEND_DIST)) {
    app.get('*', (req, res) => {
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('[Dashboard] Browser connected');
    socket.emit('init_state', {
        status: botStatus,
        globalPaused,
        pending: [...pendingMessages.values()]
    });
    socket.on('disconnect', () => console.log('[Dashboard] Browser disconnected'));
});

// ── Media helpers ─────────────────────────────────────────────────────────────

function tryRequire(pkg) {
    try { return require(pkg); } catch { return null; }
}

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
        return `[Customer sent an image. Contents: ${description}]`;
    } catch (e) {
        console.warn('[Vision] Vision model unavailable:', e.message);
        return `[Customer sent an image (${mime}) but vision model is not available.]`;
    }
}

async function extractPdfText(buffer) {
    const pdfParse = tryRequire('pdf-parse');
    if (!pdfParse) return null;
    try {
        const data = await pdfParse(buffer);
        return data.text?.trim().substring(0, 3000) || null;
    } catch (e) {
        console.warn('[PDF] Extraction failed:', e.message);
        return null;
    }
}

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

async function describeMedia(message) {
    try {
        const media = await message.downloadMedia();
        if (!media) return null;

        const mime = media.mimetype || '';
        const buf  = Buffer.from(media.data, 'base64');

        if (mime.startsWith('image/'))
            return await describeImageWithVision(media.data, mime);
        if (mime.includes('pdf')) {
            const text = await extractPdfText(buf);
            return text
                ? `[Customer sent a PDF. Contents:\n${text}\n\nAnswer their question based on this document.]`
                : `[Customer sent a PDF but text extraction failed.]`;
        }
        if (mime.includes('word') || mime.includes('officedocument.wordprocessingml')) {
            const text = await extractDocxText(buf);
            return text
                ? `[Customer sent a Word document. Contents:\n${text}]`
                : `[Customer sent a Word doc but extraction failed.]`;
        }
        if (mime.startsWith('text/'))
            return `[Customer sent a text file. Contents:\n${buf.toString('utf8').substring(0, 3000)}]`;
        if (mime.startsWith('audio/'))
            return `[Customer sent a voice/audio message. Let them know you can't process audio yet.]`;
        if (mime.startsWith('video/'))
            return `[Customer sent a video. Acknowledge and ask them to describe what they need.]`;

        return `[Customer sent a file (${mime}).]`;
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
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'
        ]
    }
});

// ── Client events ─────────────────────────────────────────────────────────────

client.on('qr', (qr) => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║     Scan this QR code with WhatsApp      ║');
    console.log('║  Open WhatsApp → Settings → Linked Devices ║');
    console.log('╚══════════════════════════════════════════╝\n');
    qrcode.generate(qr, { small: true });
    io.emit('qr_code', { qr });
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp authenticated!');
    botStatus = 'authenticated';
    io.emit('bot_status', { status: 'authenticated' });
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failed:', msg);
    botStatus = 'auth_failed';
    io.emit('bot_status', { status: 'auth_failed' });
});

client.on('ready', () => {
    botStatus = 'ready';
    io.emit('bot_status', { status: 'ready' });

    console.log('\n╔══════════════════════════════════════════╗');
    console.log(`║  ${BOT_NAME} — Dashboard Mode              ║`);
    console.log('╚══════════════════════════════════════════╝\n');
    console.log(`[Dashboard] Open http://localhost:${DASHBOARD_PORT} to manage replies`);
    console.log('[Config] Allowed numbers:', ALLOWED_NUMS.length ? ALLOWED_NUMS.join(', ') : 'ALL');
    console.log('[Config] History TTL:', HISTORY_TTL_MS / 3600000, 'hours\n');
});

// Capture YOUR outgoing messages (manual replies from phone)
client.on('message_create', async (message) => {
    if (!message.fromMe) return;
    if (message.isStatus) return;

    const to = (message.to || '').replace(/@c\.us$|@lid$/, '');
    if (!to || message.to?.endsWith('@g.us')) return;

    const text = message.body?.trim();
    if (!text) return;

    // Control commands
    if (text.startsWith('!pause')) {
        const target = text.split(' ')[1]?.trim() || '';
        if (target === 'all') {
            globalPaused = true;
            console.log('[Bot] Globally PAUSED');
        } else if (target) {
            pausedContacts.set(target, Date.now() + TAKEOVER_TTL_MS);
            console.log(`[Bot] Paused for ${target}`);
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

    // Skip messages already stored by the API reply endpoint
    if (recentApiReplies.has(text)) {
        recentApiReplies.delete(text);
        pausedContacts.set(to, Date.now() + TAKEOVER_TTL_MS);
        return;
    }

    // Manual reply from your phone — store in history and auto-pause
    addToHistory(to, 'assistant', text);
    pausedContacts.set(to, Date.now() + TAKEOVER_TTL_MS);
    console.log(`[History] Saved your manual reply to ${to}`);
});

// Incoming messages — generate suggestions instead of auto-replying
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

        let userText = message.body?.trim();
        if (!userText && message.hasMedia) {
            userText = await describeMedia(message);
        }
        if (!userText) return;

        console.log(`[MSG] From ${senderNumber}: ${userText.substring(0, 100)}`);
        addToHistory(senderNumber, 'user', userText);

        // Resolve contact name
        let contactName = senderNumber;
        try {
            const contact = await message.getContact();
            contactName = contact.pushname || contact.name || senderNumber;
        } catch {}

        // ── Emit to dashboard IMMEDIATELY so it shows up right away ──
        const pending = {
            id: message.id._serialized,
            from: senderNumber,
            chatId: message.from,
            name: contactName,
            text: userText,
            suggestions: [],   // empty — will be filled in a moment
            ts: Date.now()
        };
        pendingMessages.set(pending.id, pending);
        io.emit('new_pending', pending);
        console.log(`[Pending] Message from ${senderNumber} sent to dashboard`);

        // ── Generate suggestions in background (don't block the emit above) ──
        getSuggestions(userText, getHistory(senderNumber))
            .then(suggestions => {
                pending.suggestions = suggestions;
                io.emit('suggestions_updated', { messageId: pending.id, suggestions });
                console.log(`[Suggestions] Ready for ${senderNumber}`);
            })
            .catch(err => {
                console.error('[Suggestions] Failed:', err.message);
                const fallback = [
                    "Got it! I'll get back to you shortly.",
                    "Sure, happy to help! What do you need?",
                    "Thanks for reaching out!"
                ];
                pending.suggestions = fallback;
                io.emit('suggestions_updated', { messageId: pending.id, suggestions: fallback });
            });

    } catch (err) {
        console.error('[Error]', err.message);
    }
});

client.on('disconnected', (reason) => {
    botStatus = 'disconnected';
    io.emit('bot_status', { status: 'disconnected' });
    console.log('⚠️  Disconnected:', reason, '— retrying in 5s...');
    setTimeout(() => startWhatsApp(), 5000);
});

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('\nStarting WhatsApp Personal Bot (Dashboard Mode)...');

// Start HTTP server first
httpServer.listen(DASHBOARD_PORT, () => {
    console.log(`[Dashboard] Running at http://localhost:${DASHBOARD_PORT}`);
});

// Warm up Ollama
(async () => {
    try {
        console.log(`[Warmup] Loading ${OLLAMA_MODEL}...`);
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

// ── Auto-restart on Puppeteer crash ──────────────────────────────────────────
async function startWhatsApp() {
    try {
        await client.initialize();
    } catch (err) {
        console.error('[WhatsApp] Crash:', err.message);
        console.log('[WhatsApp] Restarting in 5s...');
        setTimeout(() => startWhatsApp(), 5000);
    }
}

// Catch any stray unhandled rejections (e.g. Puppeteer ProtocolError)
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('ProtocolError') || reason?.message?.includes('Execution context')) {
        console.warn('[WhatsApp] Puppeteer context error — will restart automatically');
        setTimeout(() => startWhatsApp(), 5000);
    } else {
        console.error('[UnhandledRejection]', reason);
    }
});

startWhatsApp();;
