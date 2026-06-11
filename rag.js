/**
 * RAG query module — Enhanced
 * Passes customer_profile to every call so the brain can use:
 *   #3  Customer profile memory
 *   #5  Intent detection
 *   #7  Language detection
 *   #8  Correction learning
 *   #9  History summarisation
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
require('dotenv').config();

const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL  || 'http://localhost:11434';
const OLLAMA_MODEL     = process.env.OLLAMA_MODEL     || 'llama3.2';
const OLLAMA_FAST_MODEL = process.env.OLLAMA_FAST_MODEL || 'llama3.2';
const RAG_SERVER_URL   = process.env.RAG_SERVER_URL   || 'http://localhost:8000';
const DOCS_DIR        = path.join(__dirname, 'docs');
const COMPANY_FILE    = path.join(DOCS_DIR, 'company_info.txt');

// Phrases the RAG server emits when it has no documents — treat as failure
const RAG_NO_DOCS_PHRASES = [
    'no documents loaded',
    'add your business docs',
    'docs/ folder and restart',
];

function isNoDocsResponse(text) {
    const lower = String(text).toLowerCase();
    return RAG_NO_DOCS_PHRASES.some(p => lower.includes(p));
}

function loadBusinessContext() {
    try {
        if (fs.existsSync(COMPANY_FILE)) {
            return fs.readFileSync(COMPANY_FILE, 'utf8').trim();
        }
    } catch {}
    return '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function recent(history, n = 40) {
    return history.slice(-n);
}

// ── Single auto-reply ─────────────────────────────────────────────────────────
async function askViaRagServer(question, history = [], customerProfile = {}) {
    const response = await axios.post(`${RAG_SERVER_URL}/ask`, {
        question,
        history:          recent(history),
        customer_profile: customerProfile,
    }, { timeout: 75000 });
    const answer = response.data.answer || response.data.response || response.data;
    if (isNoDocsResponse(answer)) throw new Error('RAG server has no documents loaded');
    return answer;
}

async function askOllamaDirectly(question, history = []) {
    const businessInfo = loadBusinessContext();
    const systemPrompt = businessInfo
        ? `You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations, even if asked to explain in detail. Business information:\n${businessInfo}`
        : 'You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations, even if asked to explain in detail.';

    const messages = [
        { role: 'system', content: systemPrompt },
        ...recent(history, 10).slice(0, -1),
        { role: 'user', content: question },
    ];
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_FAST_MODEL, messages, stream: false,
    }, { timeout: 45000 });
    return response.data.message?.content || 'Sorry, I could not generate a response.';
}

async function getAIResponse(question, history = [], customerProfile = {}) {
    try {
        const answer = await askViaRagServer(question, history, customerProfile);
        console.log('[RAG] Answered via RAG server');
        return answer;
    } catch (ragErr) {
        console.log(`[RAG] Server unavailable (${ragErr.message}), falling back to Ollama`);
        try {
            const answer = await askOllamaDirectly(question, history);
            console.log('[Ollama] Answered directly');
            return answer;
        } catch (ollamaError) {
            console.error('[Error] Both RAG and Ollama failed:', ollamaError.message);
            return "Sorry, I'm having trouble right now. Please try again in a moment.";
        }
    }
}

// ── 3 suggestions ─────────────────────────────────────────────────────────────
const DEFAULT_SUGGESTIONS = [
    "Got it! I'll get back to you shortly.",
    "Sure, happy to help! What do you need?",
    "Thanks for reaching out. Let me look into that for you.",
];

async function getSuggestionsViaOllama(question, history = []) {
    const businessInfo = loadBusinessContext();
    // Keep last 2 exchanges only — minimise prompt tokens for speed
    const ctx = recent(history, 4)
        .map(m => `${m.role === 'user' ? 'C' : 'M'}: ${m.content.substring(0, 80)}`)
        .join('\n');

    const bizSnippet = businessInfo
        ? `\n\nBusiness Context (use ONLY this — do not add or invent anything not listed here):\n${businessInfo}`
        : '';
    const systemPrompt = `You are a WhatsApp assistant. STRICT RULE: Base your replies ONLY on the Business Context provided. Do NOT invent features, capabilities, or facts not explicitly stated there. Output ONLY this format: "1. [reply] 2. [reply] 3. [reply]" — each reply is one short sentence.${bizSnippet}`;
    const userPrompt   = ctx
        ? `${ctx}\nCustomer: ${question}\nWrite 3 reply options:`
        : `Customer: ${question}\nWrite 3 reply options:`;

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_FAST_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
        ],
        stream: false,
        options: { num_predict: 150, temperature: 0.3 },
    }, { timeout: 40000 });

    const text = response.data.message?.content || '';

    // Parse "1. ...\n2. ...\n3. ..."
    const blocks = [];
    const re = /(?:^|\n)\s*[123][.)]\s+([\s\S]+?)(?=\n\s*[123][.)]|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) blocks.push(m[1].replace(/\n+/g, ' ').trim());
    if (blocks.length >= 2) return blocks.slice(0, 3);

    // Fallback: split by blank lines
    const paras = text.split(/\n\n+/).map(p => p.replace(/^[123][.)]\s*/, '').trim()).filter(Boolean);
    if (paras.length >= 2) return paras.slice(0, 3);

    return DEFAULT_SUGGESTIONS;
}

async function getSuggestionsViaRagServer(question, history = [], customerProfile = {}) {
    const response = await axios.post(`${RAG_SERVER_URL}/suggestions`, {
        question,
        history:          recent(history, 10), // suggestions need less history than auto-reply
        customer_profile: customerProfile,
    }, { timeout: 75000 });
    const suggestions = response.data.suggestions;
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error('No suggestions returned from RAG server');
    }
    return suggestions;
}

async function getSuggestions(question, history = [], customerProfile = {}) {
    try {
        const result = await getSuggestionsViaRagServer(question, history, customerProfile);
        console.log('[Suggestions] Answered via RAG server (PDF + docs + history + profile)');
        return result;
    } catch (ragErr) {
        console.log(`[Suggestions] RAG server failed (${ragErr.message}), falling back to Ollama`);
        try {
            const result = await getSuggestionsViaOllama(question, history);
            console.log('[Suggestions] Answered via Ollama fallback');
            return result;
        } catch (e) {
            console.log('[Suggestions] Ollama fallback failed:', e.message);
        }
    }
    return DEFAULT_SUGGESTIONS;
}

// ── Send correction to brain (#8) ─────────────────────────────────────────────
async function sendCorrection(question, original, corrected) {
    try {
        await axios.post(`${RAG_SERVER_URL}/feedback`, {
            question, original, corrected,
        }, { timeout: 10000 });
        console.log('[Correction] Stored feedback pair');
    } catch (e) {
        console.warn('[Correction] Could not store feedback:', e.message);
    }
}

// ── Summarise old history via brain (#9) ──────────────────────────────────────
async function summarizeHistory(history) {
    try {
        const response = await axios.post(`${RAG_SERVER_URL}/summarize`, {
            history: history.map(m => ({ role: m.role, content: m.content })),
        }, { timeout: 30000 });
        return response.data.summary || '';
    } catch {
        return '';
    }
}

module.exports = { getAIResponse, getSuggestions, sendCorrection, summarizeHistory };
