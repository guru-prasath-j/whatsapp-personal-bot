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

const OLLAMA_BASE_URL   = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const OLLAMA_MODEL      = process.env.OLLAMA_MODEL      || 'llama3.2';
const OLLAMA_FAST_MODEL = process.env.OLLAMA_FAST_MODEL || 'llama3.2';
const RAG_SERVER_URL    = process.env.RAG_SERVER_URL    || 'http://localhost:8000';
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY    || '';
const OPENAI_MODEL      = process.env.OPENAI_MODEL      || 'gpt-4o-mini';
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

function loadBusinessContext(question = '', maxChars = 15000) {
    const parts = [];
    const loaded = [];
    try {
        // company_info.txt always first
        if (fs.existsSync(COMPANY_FILE)) {
            const c = fs.readFileSync(COMPANY_FILE, 'utf8').trim();
            if (c) { parts.push(c); loaded.push('company_info.txt'); }
        }
        // Other txt files — pick relevant sections based on question keywords
        if (fs.existsSync(DOCS_DIR)) {
            const keywords = question.toLowerCase().split(/\W+/).filter(w => w.length > 2);
            const files = fs.readdirSync(DOCS_DIR)
                .filter(f => f.endsWith('.txt') && f !== path.basename(COMPANY_FILE));

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8').trim();
                    if (content.length < 50) continue;

                    // Split into sections by === headers
                    const sections = content.split(/\n(?====)/).map(s => s.trim()).filter(s => s.length > 50);

                    if (keywords.length > 0 && sections.length > 3) {
                        // Score each section by how many keywords it contains
                        const scored = sections
                            .map(s => ({
                                text: s,
                                score: keywords.reduce((n, kw) => n + (s.toLowerCase().includes(kw) ? 1 : 0), 0)
                            }))
                            .sort((a, b) => b.score - a.score);

                        const topScore = scored[0]?.score || 0;
                        // Take top 5 most relevant sections
                        const relevant = scored.slice(0, 5).map(s => s.text).join('\n\n');
                        parts.push(`--- ${file} ---\n${relevant}`);
                        loaded.push(`${file} (keyword match, top score: ${topScore})`);
                    } else {
                        parts.push(`--- ${file} ---\n${content.substring(0, 8000)}`);
                        loaded.push(`${file} (full, ${sections.length} sections)`);
                    }
                } catch {}
            }
        }
    } catch {}
    const result = parts.join('\n\n').substring(0, maxChars);
    if (loaded.length > 0) {
        console.log(`[Docs] Loaded for context: ${loaded.join(', ')} → ${result.length} chars`);
    } else {
        console.log('[Docs] No docs found — Ollama will answer from general knowledge only');
    }
    return result;
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
    const businessInfo = loadBusinessContext(question, 8000); // keyword-relevant sections
    console.log(`[Ollama] Answering based on: ${businessInfo ? `docs (${businessInfo.length} chars)` : 'general knowledge (no docs)'}`);
    const systemPrompt = businessInfo
        ? `You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations, even if asked to explain in detail. Business information:\n${businessInfo}`
        : 'You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations, even if asked to explain in detail.';

    const messages = [
        { role: 'system', content: systemPrompt },
        ...recent(history, 4).slice(0, -1), // Fix 4: 4 messages instead of 10
        { role: 'user', content: question },
    ];
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_FAST_MODEL, messages, stream: false,
        keep_alive: -1,                          // Fix 1: keep model loaded permanently
        options: { num_predict: 80, temperature: 0.3 }, // Fix 2: cap output at 80 tokens
    }, { timeout: 90000 });
    return response.data.message?.content || 'Sorry, I could not generate a response.';
}

// Fix 3: pre-warm — loads model into memory at startup so first real message is fast
async function warmupOllama() {
    try {
        await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: OLLAMA_FAST_MODEL,
            messages: [{ role: 'user', content: 'hi' }],
            stream: false,
            keep_alive: -1,
            options: { num_predict: 1 },
        }, { timeout: 60000 });
        console.log('[Ollama] Model warmed up and loaded in memory');
    } catch (e) {
        console.warn('[Ollama] Warmup failed (Ollama may not be running):', e.message);
    }
}

async function askChatGPT(question, history = []) {
    const businessInfo = loadBusinessContext(question, 8000);
    const systemPrompt = businessInfo
        ? `You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations. Business information:\n${businessInfo}`
        : 'You are a WhatsApp assistant. Reply in 2-3 short sentences only — no lists, no markdown, no long explanations.';

    const messages = [
        { role: 'system', content: systemPrompt },
        ...recent(history, 4).slice(0, -1),
        { role: 'user', content: question },
    ];
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: OPENAI_MODEL,
        messages,
        max_tokens: 150,
        temperature: 0.3,
    }, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
    });
    return response.data.choices?.[0]?.message?.content?.trim() || 'Sorry, I could not generate a response.';
}

async function getChatGPTSuggestions(question, history = []) {
    const businessInfo = loadBusinessContext(question, 8000);
    const ctx = recent(history, 4)
        .map(m => `${m.role === 'user' ? 'C' : 'M'}: ${m.content.substring(0, 80)}`)
        .join('\n');
    const bizSnippet = businessInfo
        ? `\n\nBusiness Context (use ONLY this — do not add or invent anything not listed here):\n${businessInfo}`
        : '';
    const systemPrompt = `You are a WhatsApp assistant. STRICT RULE: Base your replies ONLY on the Business Context provided. IMPORTANT: If any previous message in the conversation contradicts the Business Context, always follow the Business Context — it is the source of truth. Output ONLY this format: "1. [reply] 2. [reply] 3. [reply]" — each reply is one short sentence.${bizSnippet}`;
    const userPrompt = ctx
        ? `${ctx}\nCustomer: ${question}\nWrite 3 reply options based ONLY on the Business Context above (ignore any wrong info in chat history):`
        : `Customer: ${question}\nWrite 3 reply options:`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: OPENAI_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.4,
    }, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
    });
    const text = response.data.choices?.[0]?.message?.content || '';
    const blocks = [];
    const re = /(?:^|\n)\s*[123][.)]\s+([\s\S]+?)(?=\n\s*[123][.)]|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) blocks.push(m[1].replace(/\n+/g, ' ').trim());
    if (blocks.length >= 2) return blocks.slice(0, 3);
    const paras = text.split(/\n\n+/).map(p => p.replace(/^[123][.)]\s*/, '').trim()).filter(Boolean);
    if (paras.length >= 2) return paras.slice(0, 3);
    return DEFAULT_SUGGESTIONS;
}

async function getAIResponse(question, history = [], customerProfile = {}) {
    try {
        const answer = await askViaRagServer(question, history, customerProfile);
        console.log('[RAG] Answered via RAG server');
        return answer;
    } catch (ragErr) {
        console.log(`[RAG] Server unavailable (${ragErr.message}), falling back to LLM`);
        if (OPENAI_API_KEY) {
            try {
                const answer = await askChatGPT(question, history);
                console.log('[ChatGPT] Answered directly');
                return answer;
            } catch (openaiErr) {
                const status = openaiErr.response?.status;
                console.warn(`[ChatGPT] Failed (${status || openaiErr.message}), falling back to Ollama`);
            }
        }
        const answer = await askOllamaDirectly(question, history);
        console.log('[Ollama] Answered directly');
        return answer;
    }
}

// ── 3 suggestions ─────────────────────────────────────────────────────────────
const DEFAULT_SUGGESTIONS = [
    "Got it! I'll get back to you shortly.",
    "Sure, happy to help! What do you need?",
    "Thanks for reaching out. Let me look into that for you.",
];

async function getSuggestionsViaOllama(question, history = []) {
    const businessInfo = loadBusinessContext(question, 8000); // keyword-relevant sections
    // Keep last 2 exchanges only — minimise prompt tokens for speed
    const ctx = recent(history, 4)
        .map(m => `${m.role === 'user' ? 'C' : 'M'}: ${m.content.substring(0, 80)}`)
        .join('\n');

    const bizSnippet = businessInfo
        ? `\n\nBusiness Context (use ONLY this — do not add or invent anything not listed here):\n${businessInfo}`
        : '';
    const systemPrompt = `You are a WhatsApp assistant. STRICT RULE: Base your replies ONLY on the Business Context provided. Do NOT invent features, capabilities, or facts not explicitly stated there. IMPORTANT: If any previous message in the conversation contradicts the Business Context, always follow the Business Context — it is the source of truth. Output ONLY this format: "1. [reply] 2. [reply] 3. [reply]" — each reply is one short sentence.${bizSnippet}`;
    const userPrompt   = ctx
        ? `${ctx}\nCustomer: ${question}\nWrite 3 reply options based ONLY on the Business Context above (ignore any wrong info in chat history):`
        : `Customer: ${question}\nWrite 3 reply options:`;

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_FAST_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
        ],
        stream: false,
        keep_alive: -1,
        options: { num_predict: 150, temperature: 0.3 },
    }, { timeout: 60000 });

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
        console.log(`[Suggestions] RAG server failed (${ragErr.message}), falling back to LLM`);
        if (OPENAI_API_KEY) {
            try {
                const result = await getChatGPTSuggestions(question, history);
                console.log('[Suggestions] Answered via ChatGPT');
                return result;
            } catch (openaiErr) {
                const status = openaiErr.response?.status;
                console.warn(`[Suggestions] ChatGPT failed (${status || openaiErr.message}), falling back to Ollama`);
            }
        }
        const result = await getSuggestionsViaOllama(question, history);
        console.log('[Suggestions] Answered via Ollama');
        return result;
    }
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

module.exports = { getAIResponse, getSuggestions, sendCorrection, summarizeHistory, warmupOllama };
