/**
 * WhatsApp Personal Bot
 * Uses whatsapp-web.js to connect your personal WhatsApp number
 * and reply to messages using RAG + Ollama AI
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { getAIResponse } = require('./rag');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME      = process.env.BOT_NAME || 'WhatsApp Brain';
const TYPING_DELAY  = parseInt(process.env.TYPING_DELAY) || 2000;
const IGNORE_SELF   = process.env.IGNORE_SELF !== 'false';
const ALLOWED_NUMS  = process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];

// Track processed message IDs to avoid duplicates
const processedMessages = new Set();

// Per-sender conversation history — persisted to disk so restarts don't lose context
const HISTORY_FILE = path.join(__dirname, 'conversation_history.json');
const MAX_HISTORY = 20;

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            return new Map(Object.entries(data));
        }
    } catch (e) { /* ignore corrupt file */ }
    return new Map();
}

function saveHistory(map) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(Object.fromEntries(map)), 'utf8');
    } catch (e) { console.error('[History] Failed to save:', e.message); }
}

const conversationHistory = loadHistory();
console.log(`[History] Loaded history for ${conversationHistory.size} contact(s)`);

function getHistory(sender) {
    if (!conversationHistory.has(sender)) conversationHistory.set(sender, []);
    return conversationHistory.get(sender);
}

function addToHistory(sender, role, content) {
    const history = getHistory(sender);
    history.push({ role, content });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    saveHistory(conversationHistory);
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-brain' }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
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
    console.log('\nWaiting for QR scan...\n');
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp authenticated successfully!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    console.log('Delete the .wwebjs_auth folder and restart to re-scan QR code.');
});

client.on('ready', () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log(`║  ${BOT_NAME} is LIVE on your personal number  ║`);
    console.log('╚══════════════════════════════════════════╝\n');
    if (ALLOWED_NUMS.length > 0) {
        console.log(`[Config] Only replying to: ${ALLOWED_NUMS.join(', ')}`);
    } else {
        console.log('[Config] Replying to ALL incoming messages');
    }
    console.log('[Config] Ignore self messages:', IGNORE_SELF);
    console.log('[Config] Typing delay:', TYPING_DELAY, 'ms\n');
});

client.on('message', async (message) => {
    try {
        // Skip duplicate messages
        if (processedMessages.has(message.id._serialized)) return;
        processedMessages.add(message.id._serialized);

        // Skip status updates
        if (message.isStatus) return;

        // Skip messages from yourself
        if (IGNORE_SELF && message.fromMe) return;

        // Skip group messages (optional — remove this to handle groups too)
        if (message.from.endsWith('@g.us')) {
            console.log(`[Skip] Group message from ${message.from}`);
            return;
        }

        // Check allowed numbers filter
        const senderNumber = message.from.replace('@c.us', '');
        if (ALLOWED_NUMS.length > 0 && !ALLOWED_NUMS.includes(senderNumber)) {
            console.log(`[Skip] ${senderNumber} not in allowed list`);
            return;
        }

        const text = message.body?.trim();
        if (!text) return;

        console.log(`[MSG] From ${senderNumber}: ${text}`);

        // Add user message to history
        addToHistory(senderNumber, 'user', text);

        // Show typing indicator
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Add human-like delay
        await new Promise(r => setTimeout(r, TYPING_DELAY));

        // Get AI response with conversation history
        const reply = await getAIResponse(text, getHistory(senderNumber));

        // Add assistant reply to history
        addToHistory(senderNumber, 'assistant', reply);

        // Stop typing indicator
        await chat.clearState();

        // Send reply
        await message.reply(reply);
        console.log(`[REPLY] To ${senderNumber}: ${reply.substring(0, 80)}...`);

    } catch (err) {
        console.error('[Error] Failed to process message:', err.message);
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️  WhatsApp disconnected:', reason);
    console.log('Attempting to reconnect...');
    client.initialize();
});

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('\nStarting WhatsApp Personal Bot...');

// Warm up Ollama so the model is loaded before the first real message
(async () => {
    try {
        const axios = require('axios');
        const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
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
