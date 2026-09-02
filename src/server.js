import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { ensureTempDir, downloadAudio, convertToWav } from './services/audioConverter.js';
import { processAudioWithGemini } from './services/aiService.js';
import {
  dispatchFormattedMessage,
  sendTextMessage,
  sendSenderAction,
} from './services/messengerService.js';

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Body parser
app.use(express.json());

// Initialize temp directory on startup
ensureTempDir();

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Meta Webhook Verification (GET /webhook)
 * Handles the initial verification challenge from Meta App Dashboard.
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Verification successful.');
      return res.status(200).send(challenge);
    } else {
      console.warn('[Webhook] Verification failed: Token mismatch or invalid mode.');
      return res.sendStatus(403);
    }
  }

  return res.status(400).send('Missing hub parameters');
});

/**
 * Process a single incoming voice note / audio event asynchronously
 * @param {object} webhookEvent - Meta messaging event object
 */
async function processVoiceEvent(webhookEvent) {
  const senderId = webhookEvent.sender?.id;
  const attachments = webhookEvent.message?.attachments || [];
  const audioAttachment = attachments.find((att) => att.type === 'audio');

  if (!senderId || !audioAttachment || !audioAttachment.payload?.url) {
    return;
  }

  const audioUrl = audioAttachment.payload.url;
  const requestId = crypto.randomBytes(6).toString('hex');
  const tempDir = ensureTempDir();
  const inputAudioPath = path.join(tempDir, `input-${requestId}.mp4`);
  const wavAudioPath = path.join(tempDir, `converted-${requestId}.wav`);

  console.log(`[${requestId}] Received voice note from sender: ${senderId}`);

  try {
    // Show user that the bot received the message and is typing
    await sendSenderAction(senderId, 'mark_seen');
    await sendSenderAction(senderId, 'typing_on');

    // 1. Download audio from Messenger CDN
    console.log(`[${requestId}] Downloading audio from URL...`);
    await downloadAudio(audioUrl, inputAudioPath);

    // 2. Convert audio to 16kHz mono WAV for optimal Speech-to-Text accuracy
    console.log(`[${requestId}] Converting audio to 16kHz mono WAV...`);
    await convertToWav(inputAudioPath, wavAudioPath);

    // 3. Transcribe & summarize with native multimodal Gemini 3.6 Flash
    console.log(`[${requestId}] Transcribing & processing audio with Gemini 3.6 Flash...`);
    const processedResponse = await processAudioWithGemini(wavAudioPath);

    if (!processedResponse || processedResponse.trim().length === 0) {
      console.log(`[${requestId}] Empty transcript returned.`);
      await sendTextMessage(
        senderId,
        '⚠️ Could not detect any clear speech in the voice note. Please try speaking closer to the microphone.'
      );
      return;
    }

    console.log(`[${requestId}] Transcription and processing complete (${processedResponse.length} chars).`);

    // 4. Dispatch result back to user via Messenger (chunking if > 1900 chars)
    console.log(`[${requestId}] Dispatching response to user...`);
    await dispatchFormattedMessage(senderId, processedResponse);
    console.log(`[${requestId}] Response successfully dispatched.`);
  } catch (error) {
    console.error(`[${requestId}] Error processing audio note:`, error);
    try {
      await sendTextMessage(
        senderId,
        '❌ Sorry, an error occurred while transcribing your voice note. Please try again later.'
      );
    } catch (dispatchErr) {
      console.error(`[${requestId}] Failed to send error message to user:`, dispatchErr.message);
    }
  } finally {
    // Ensure complete cleanup of temporary audio files using fs.unlinkSync to prevent disk leakage
    console.log(`[${requestId}] Cleaning up temporary audio files...`);
    for (const tempFilePath of [inputAudioPath, wavAudioPath]) {
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupErr) {
        console.warn(`[${requestId}] Cleanup warning for ${tempFilePath}:`, cleanupErr.message);
      }
    }
    await sendSenderAction(senderId, 'typing_off');
  }
}

/**
 * Meta Webhook Event Handler (POST /webhook)
 * Immediately returns HTTP 200 'EVENT_RECEIVED' before running async processing.
 */
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    // Respond immediately to Meta within 20 seconds to prevent webhook timeouts
    res.status(200).send('EVENT_RECEIVED');

    // Asynchronously process all entries
    (async () => {
      for (const entry of body.entry || []) {
        for (const webhookEvent of entry.messaging || []) {
          // Check if event has audio attachments
          const attachments = webhookEvent.message?.attachments || [];
          const hasAudio = attachments.some((att) => att.type === 'audio');

          if (hasAudio) {
            await processVoiceEvent(webhookEvent);
          }
        }
      }
    })().catch((err) => {
      console.error('[Webhook] Unhandled asynchronous processing error:', err);
    });
  } else {
    // Returns 404 if event is not from a page subscription
    res.sendStatus(404);
  }
});

// Start Express server if not in test environment
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`🚀 Messenger Transcribe Bot server is listening on port ${PORT}`);
    console.log(`🔗 Webhook verification URL: http://localhost:${PORT}/webhook`);
  });

  // Graceful shutdown handling
  const handleShutdown = (signal) => {
    console.log(`Received ${signal}. Gracefully shutting down...`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

export default app;
