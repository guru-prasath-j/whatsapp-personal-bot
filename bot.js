/**
 * WhatsApp Personal Bot
 * Uses whatsapp-web.js to connect your personal WhatsApp number
 * and reply to messages using RAG + Ollama AI
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { getAIResponse } = require('./rag');
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

        // Show typing indicator
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Add human-like delay
        await new Promise(r => setTimeout(r, TYPING_DELAY));

        // Get AI response
        const reply = await getAIResponse(text);

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
console.log('\n🚀 Starting WhatsApp Personal Bot..