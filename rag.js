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

/**
 * Ask a question via the existing whatsapp_brain RAG server
 * history: array of {role, content} (last N messages)
 */
async function askViaRagServer(question, history = []) {
    const response = await axios.post(`${RAG_SERVER_URL}/ask`, {
        question,
        history
    }, { timeout: 30000 });
    return response.data.answer || response.data.response || response.data;
}

/**
 * Ask Ollama directly (fallback if RAG server is down)
 * history: array of {role, content} (last N messages)
 */
async function askOllamaDirectly(question, history = []) {
    // Build messages: system prompt + conversation history + current question
    const messages = [
        {
            role: 'system',
            content: 'You are a helpful WhatsApp assistant. Keep replies short, friendly and suitable for WhatsApp. No markdown formatting. Use the conversation history to give contextual, coherent replies.'
        },
        // Include prior turns (history already contains the current user message at the end)
        ...history.slice(0, -1),  // all but the last (current) user message
        {
            role: 'user',
            content: question
        }
    ];

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
        model: OLLAMA_MODEL,
        messages,
        stream: false
    }, { timeout: 120000 });
    return response.data.message?.content || 'Sorry, I could not generate a response.';
}

/**
 * Main function — tries RAG server first, falls back to direct Ollama
 * history: array of {role, content} (last N messages including current)
 */
async function getAIResponse(question, history = []) {
    try {
        const answer = await askViaRagServer(question, history);
        console.log(`[RAG] Answered via RAG server`);
        return answer;
    } catch (ragError) {
        console.log(`[RAG] Server unavailable, falling back to direct Ollama`);
        try {
            const answer = await askOllamaDirectly(question, history);
            console.log(`[Ollama] Answered directly`);
            return answer;
        } catch (ollamaError) {
            console.error(`[Error] Both RAG and Ollama failed:`, ollamaError.message);
            return "Sorry, I'm having trouble right now. Please try again in a moment.";
        }
    }
}

module.exports = { getAIResponse };
