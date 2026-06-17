# WhatsApp AI Dashboard

A WhatsApp bot that reads your business documents and automatically replies to customer messages using AI. It includes a live dashboard where you can view conversations, edit replies before sending, and upload your business info.

---

## Requirements

Install these before anything else:

| Tool | Download |
|------|----------|
| Node.js v18+ | https://nodejs.org |
| Python 3.10+ | https://python.org |
| Google Chrome | https://google.com/chrome |
| Ollama | https://ollama.com |

Pull the AI models:

```
ollama pull llama3.2
ollama pull nomic-embed-text
```

---

## Step 1 — Install Everything

Open PowerShell and run this single command:

```powershell
cd E:\Whatsapp-ai-dashboard\whatsapp-personal-bot; if (!(Test-Path .env)) { Copy-Item .env.example .env }; npm run setup; cd whatsapp-brain; if (!(Test-Path .env)) { Copy-Item .env.example .env }; pip install -r requirements.txt; cd ..
```

When you run this, it will:

1. Create `.env` file for the bot (copied from `.env.example`)
2. Install all bot dependencies
3. Build the frontend dashboard
4. Create `.env` file for the brain (copied from `.env.example`)
5. Install all Python dependencies for the brain

> `.env` files are only created if they don't already exist — your existing config will never be overwritten.

---

## Step 2 — Configure API Key

Open both `.env` files and set your `OPENAI_API_KEY`:

```
whatsapp-personal-bot/.env
whatsapp-personal-bot/whatsapp-brain/.env
```

```env
OPENAI_API_KEY=sk-your-key-here
```

- **If you set a key** — ChatGPT (`gpt-4o-mini`) will be used to generate replies
- **If you leave it empty** — Ollama (`llama3.2`) will be used automatically as the fallback

> You only need one key for both files. Copy the same key into both `.env` files.

---

## Step 3 — Run the Project

### Option A — One Command (opens 3 windows automatically)

Open PowerShell and run:

```powershell
Start-Process cmd -ArgumentList '/k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot && npm run brain"'; Start-Sleep 8; Start-Process cmd -ArgumentList '/k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot && npm start"'; Start-Process cmd -ArgumentList '/k "cd /d E:\Whatsapp-ai-dashboard\whatsapp-personal-bot\frontend && npm run dev"'
```

This opens 3 windows — Brain starts first, then Bot and Frontend open after 8 seconds.

---

### Option B — Double-Click or PowerShell

Double-click `start-all.bat` from the bot folder:

```
E:\Whatsapp-ai-dashboard\whatsapp-personal-bot\start-all.bat
```

Or run it from PowerShell:

```powershell
cd E:\Whatsapp-ai-dashboard\whatsapp-personal-bot
.\start-all.bat
```

Same result — opens 3 windows automatically in the correct order.

---

After starting, open your browser:

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3001 |
| Frontend Dev | http://localhost:5173 |
| Brain Health | http://localhost:8000/health |

Scan the QR code that appears in the Bot terminal with your WhatsApp to connect.

---

## Troubleshooting

**QR code not showing** — Make sure Google Chrome is installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`

**Brain not starting** — Run `ollama serve` in a terminal first, then retry

**No AI replies** — Check `http://localhost:8000/health` and make sure `docs_loaded` is greater than 0
