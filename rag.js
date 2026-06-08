/**
 * RAG query module
 * Calls your existing whatsapp_brain RAG server (localhost:8000)
 * OR calls Ollama directly if the server is down
 */

const axios = require('axios');
require('dotenv').config();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const RAG_SERVER_URL = process.env.RAG_SERVER_URL || 'http://localhost:8000';

async function askViaRagServer(question, history = []) {
    const response = await axios.post(`${RAG_SERVER_URL}/ask`, {
        question,
        history
    }, { timeout: 30000 });
    return response.data.answer || response.data.response || response.data;
}

async function askOllamaDirectly(question, history = []) {
    const messages = [
        {
            role: 'system',
            content: 'You are a helpful WhatsApp assistant. Keep replies short, friendly and suitable for WhatsApp. No markdown formatting. Use the conversation history to give contextual, coherent replies.'
        },
        ...history.slice(0, -1),
        { role: 'user', content: question }
    ];

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_MODEL,
        messages,
        stream: false
    }, { timeout: 120000 });
    return response.data.message?.content || 'Sorry, I could not generate a response.';
}

async function getAIResponse(question, history = []) {
    try {
        const answer = await askViaRagServer(question, history);
        console.log('[RAG] Answered via RAG server');
        return answer;
    } catch {
        console.log('[RAG] Server unavailable, falling back to direct Ollama');
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

/**
 * Generate 3 different reply suggestions for a WhatsApp message.
 * Returns an array of exactly 3 suggestion strings.
 */
async function getSuggestions(question, history = []) {
    const systemPrompt = `You are a WhatsApp reply assistant. Generate exactly 3 different reply suggestions.
Make each one different in tone:
1. Quick and concise
2. Warm and friendly
3. Helpful and detailed

Rules:
- Short, natural replies suitable for WhatsApp (no markdown, no asterisks)
- Return ONLY a valid JSON array: ["reply1", "reply2", "reply3"]
- No explanation or extra text`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(0, -1),
        { role: 'user', content: question }
    ];

    // Try with JSON format constraint
    try {
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: OLLAMA_MODEL,
            messages,
            stream: false,
            format: 'json'
        }, { timeout: 120000 });

        const content = response.data.message?.content?.trim() || '[]';
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed) && parsed.length >= 2) {
            const result = parsed.slice(0, 3).map(s => String(s).trim());
            while (result.length < 3) result.push(result[0]);
            return result;
        }
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const values = Object.values(parsed).map(v => String(v).trim());
            if (values.length >= 2) {
                while (values.length < 3) values.push(values[0]);
                return values.slice(0, 3);
            }
        }
        throw new Error('Unexpected JSON structure');
    } catch (firstErr) {
        console.warn('[Suggestions] JSON format attempt failed:', firstErr.message);
    }

    // Fallback: try without format constraint and extract from text
    try {
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: OLLAMA_MODEL,
            messages: [
                { role: 'system', content: 'Given a WhatsApp message, output ONLY a JSON array of 3 different reply options. Example: ["Hi!", "Hello there!", "Hey, how can I help?"]' },
                { role: 'user', content: question }
            ],
            stream: false
        }, { timeout: 60000 });

        const content = response.data.message?.content || '';
        const match = content.match(/\[[\s\S]*?\]/);
        if (match) {
            const arr = JSON.parse(match[0]);
            if (Array.isArray(arr) && arr.length >= 2) {
                const result = arr.slice(0, 3).map(s => String(s).trim());
                while (result.length < 3) result.push(result[0]);
                return result;
            }
        }
        // Extract numbered/bulleted lines
        const lines = content.split('\n')
            .map(l => l.replace(/^[\d\*\-•]+[\.\):\s]+/, '').trim())
            .filter(l => l.length > 5 && l.length < 200);
        if (lines.length >= 2) {
            const result = lines.slice(0, 3);
            while (result.length < 3) result.push(result[0]);
            return result;
        }
    } catch (secondErr) {
        console.error('[Suggestions] All attempts failed:', secondErr.message);
    }

    return [
        "Got it! I'll get back to you shortly.",
        "Sure, happy to help! What do you need?",
        "Thanks for reaching out. Let me look into that for you."
    ];
}

module.exports = { getAIResponse, getSuggestions };
