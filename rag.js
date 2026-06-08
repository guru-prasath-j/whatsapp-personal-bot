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
require('dotenv').config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3.2';
const RAG_SERVER_URL  = process.env.RAG_SERVER_URL  || 'http://localhost:8000';

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
    }, { timeout: 60000 });
    return response.data.answer || response.data.response || response.data;
}

async function askOllamaDirectly(question, history = []) {
    const messages = [
        {
            role:    'system',
            content: 'You are a helpful WhatsApp assistant. Keep replies short, friendly. No markdown.',
        },
        ...recent(history).slice(0, -1),
        { role: 'user', content: question },
    ];
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_MODEL, messages, stream: false,
    }, { timeout: 120000 });
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
async function getSuggestions(question, history = [], customerProfile = {}) {
    // 1. Try RAG server (has business docs + all enhancements)
    try {
        const response = await axios.post(`${RAG_SERVER_URL}/suggestions`, {
            question,
            history:          recent(history),
            customer_profile: customerProfile,
        }, { timeout: 90000 });
        const suggestions = response.data.suggestions;
        if (Array.isArray(suggestions) && suggestions.length >= 2) {
            console.log('[Suggestions] Answered via RAG server');
            const result = suggestions.slice(0, 3).map(s => String(s).trim());
            while (result.length < 3) result.push(result[0]);
            return result;
        }
    } catch {
        console.log('[Suggestions] RAG server unavailable, falling back to Ollama');
    }

    // 2. Fallback: direct Ollama
    try {
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model:    OLLAMA_MODEL,
            messages: [
                {
                    role:    'system',
                    content: 'Generate exactly 3 WhatsApp reply options as JSON array: ["reply1","reply2","reply3"]. No markdown.',
                },
                ...recent(history).slice(0, -1),
                { role: 'user', content: question },
            ],
            stream: false,
            format: 'json',
        }, { timeout: 120000 });

        const content = response.data.message?.content?.trim() || '[]';
        const parsed  = JSON.parse(content);
        const arr     = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (arr.length >= 2) {
            const result = arr.slice(0, 3).map(s => String(s).trim());
            while (result.length < 3) result.push(result[0]);
            return result;
        }
    } catch (e) {
        console.error('[Suggestions] All attempts failed:', e.message);
    }

    return [
        "Got it! I'll get back to you shortly.",
        "Sure, happy to help! What do you need?",
        "Thanks for reaching out. Let me look into that for you.",
    ];
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
