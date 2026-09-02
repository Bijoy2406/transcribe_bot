# Messenger Voice-to-Text & Summarization Bot (Gemini 2.5 Flash Multimodal Pipeline)

A production-ready Node.js (ESM) Facebook Messenger bot that receives voice notes, converts them into 16kHz mono WAV audio, and performs **native multimodal audio transcription and summarization in a single step using Google Gemini 2.5 Flash (`@google/genai`)**.

Optimized for conversational Bangladeshi Bengali, standard Bangla slang, and code-mixed Banglish.

---

## 🏗️ Architecture & Multimodal Audio Pipeline

1. **Meta Webhook Verification (`GET /webhook`)**:
   - Responds to Meta challenge with `hub.challenge` when `hub.verify_token` matches `VERIFY_TOKEN`.
2. **Instant Webhook Ingestion (`POST /webhook`)**:
   - Immediately returns HTTP `200 EVENT_RECEIVED` to prevent webhook timeouts.
   - Triggers background asynchronous processing for audio attachments.
3. **Audio Ingestion & Conversion**:
   - Streams the attachment from Meta's CDN to `./temp/`.
   - Normalizes audio via `fluent-ffmpeg` into 16kHz, single-channel (mono) PCM WAV.
   - Converts audio bytes to base64 encoding.
   - Safely cleans up all temporary audio files in a `finally` block using existence-checked `fs.unlinkSync` to prevent disk leaks.
4. **Native Multimodal Audio Transcription & Summarization (`gemini-2.5-flash`)**:
   - Direct inline audio data ingestion (`inlineData: { mimeType: 'audio/wav', data: base64Audio }`).
   - Accurately transcribes colloquial Bangladeshi Bengali, slang, loanwords, and code-mixed Banglish.
   - Generates a concise 2-3 bullet point summary in Bengali at the top if the message has substantive content or is > 20 seconds.
   - Strict Output Format:
     ```
     📌 *Summary:*
     • <bullet 1>
     • <bullet 2>

     ---
     📝 *Full Transcript:*
     <Accurate Bengali transcript>
     ```
5. **Outbound Dispatcher**:
   - Automatically chunks messages exceeding 1900 characters without cutting words mid-sentence.
   - Posts sequentially to Meta Graph API v20.0 `me/messages`.

---

## 📁 Project Structure

```
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── src/
│   ├── server.js                 # Express server & webhook handlers
│   └── services/
│       ├── audioConverter.js     # Audio streaming, 16kHz WAV conversion & cleanup
│       ├── aiService.js          # Native multimodal Gemini 2.5 Flash audio processor
│       └── messengerService.js   # Meta Graph API sender, chunker (1900 chars)
└── test/
    └── test.js                   # Automated test suite
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Application Port (Default: `3000`) |
| `VERIFY_TOKEN` | Custom string set in Meta App Dashboard -> Webhooks |
| `PAGE_ACCESS_TOKEN` | Meta Page Access Token with `pages_messaging` permission |
| `GEMINI_API_KEY` | Google Gemini API Key for Gemini 2.5 Flash |
| `FFMPEG_PATH` | (Optional) Custom FFmpeg binary path |

---

## 🚀 Running the Application

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Run Tests
```bash
npm test
```

---

## 🐳 Docker & Koyeb Deployment

### 1. Build and Run with Docker locally
```bash
docker build -t messenger-transcribe-bot .
docker run -p 8000:8000 --env-file .env messenger-transcribe-bot
```

### 2. Deploy to Koyeb
1. Push this repository to GitHub or GitLab.
2. In the **Koyeb Control Panel**:
   - Click **Create App / Service**.
   - Select **GitHub** as the source and choose your repository.
   - Set **Build method** to **Dockerfile**.
   - Under **Environment variables**, set:
     - `VERIFY_TOKEN`: Your Meta Webhook verification token
     - `PAGE_ACCESS_TOKEN`: Your Meta Page Access Token
     - `GEMINI_API_KEY`: Your Google Gemini API Key
     - `PORT`: `8000`
   - Under **Exposed Ports**, ensure port `8000` is mapped to protocol `HTTP` on path `/`.
3. Koyeb will automatically build the Alpine container, install `ffmpeg`, launch the app, and provide an active HTTPS endpoint:
   `https://<your-app>-<your-org>.koyeb.app/webhook`
4. Set the Callback URL in **Meta for Developers > Messenger > Webhooks** to your Koyeb endpoint.
