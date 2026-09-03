import assert from 'assert';
import fs from 'fs';
import path from 'path';
import app from '../src/server.js';
import { chunkMessage, formatResponse, dispatchFormattedMessage } from '../src/services/messengerService.js';
import { ensureTempDir, cleanupFiles } from '../src/services/audioConverter.js';
import { processAudioWithGemini, ai } from '../src/services/aiService.js';

console.log('--- Running Tests for Messenger Voice-to-Text Bot (Gemini 2.5 Flash Pipeline) ---');

// Test 1: chunkMessage logic (capped at 1900 chars)
console.log('Test 1: chunkMessage at 1900 char threshold');
const shortText = 'Hello world, short message.';
const shortChunks = chunkMessage(shortText, 1900);
assert.strictEqual(shortChunks.length, 1);
assert.strictEqual(shortChunks[0], shortText);

// Build a long text (> 2500 chars)
const longParagraph = 'কথা বলছি, মেসেঞ্জার ভয়েস মেসেজ ট্রাই করলাম কেমন আছেন। '.repeat(60);
assert(longParagraph.length > 1900, 'Long paragraph should exceed 1900 chars');
const longChunks = chunkMessage(longParagraph, 1900);
assert(longChunks.length >= 2, 'Should split into multiple chunks');
for (const chunk of longChunks) {
  assert(chunk.length <= 1900, `Chunk length ${chunk.length} should be <= 1900`);
}
console.log('✓ chunkMessage passed (all chunks <= 1900 chars)');

// Test 2: formatResponse logic
console.log('Test 2: formatResponse');
const formattedWithSummary = formatResponse({
  transcript: 'আজকের মিটিং সকাল ১০টায় শুরু হবে।',
  summary: '• মিটিং সকাল ১০টায় শুরু হবে',
});
assert(formattedWithSummary.includes('📌 **Summary:**'));
assert(formattedWithSummary.includes('📝 **Full Transcript:**'));
assert(formattedWithSummary.includes('আজকের মিটিং সকাল ১০টায় শুরু হবে।'));

const formattedWithoutSummary = formatResponse({
  transcript: 'কেমন আছেন ভাই?',
  summary: null,
});
assert(!formattedWithoutSummary.includes('📌 **Summary:**'));
assert(formattedWithoutSummary.includes('📝 **Full Transcript:**'));
assert(formattedWithoutSummary.includes('কেমন আছেন ভাই?'));
console.log('✓ formatResponse passed');

// Test 3: Audio Converter Temp Dir & Synchronous Cleanup
console.log('Test 3: ensureTempDir and cleanupFiles (fs.unlinkSync)');
const tempDir = ensureTempDir();
assert(fs.existsSync(tempDir), 'Temp directory should exist');

const dummyFile1 = path.join(tempDir, 'test-cleanup-1.mp4');
const dummyFile2 = path.join(tempDir, 'test-cleanup-2.wav');
fs.writeFileSync(dummyFile1, 'mock mp4 binary data');
fs.writeFileSync(dummyFile2, 'mock wav binary data');
assert(fs.existsSync(dummyFile1));
assert(fs.existsSync(dummyFile2));

cleanupFiles(dummyFile1, dummyFile2, path.join(tempDir, 'non-existent-sample.wav'));
assert(!fs.existsSync(dummyFile1), 'dummyFile1 should be deleted');
assert(!fs.existsSync(dummyFile2), 'dummyFile2 should be deleted');
console.log('✓ Temp dir & synchronous cleanupFiles passed');

// Test 4: Verify processAudioWithGemini
console.log('Test 4: Verify processAudioWithGemini');
assert.strictEqual(typeof processAudioWithGemini, 'function');

// Calling with non-existent file should throw
await assert.rejects(
  async () => {
    await processAudioWithGemini('/tmp/non-existent-audio-file.wav');
  },
  {
    code: 'ENOENT',
  }
);

// Verify mock Gemini 2.5 Flash multimodal invocation
const testMockWav = path.join(tempDir, 'test-gemini-mock.wav');
fs.writeFileSync(testMockWav, 'RIFF-mock-wav-audio-content');

let capturedGeminiArgs = null;
const origGenerateContent = ai.models.generateContent;

ai.models.generateContent = async (args) => {
  capturedGeminiArgs = args;
  return {
    text: '📌 *Summary:*\n• প্রজেক্ট নিয়ে আলোচনা হয়েছে\n\n---\n📝 *Full Transcript:*\nদোস্ত কি অবস্থা? কেমন আছিস রে?',
  };
};

const geminiOutput = await processAudioWithGemini(testMockWav);

assert.strictEqual(capturedGeminiArgs.model, 'gemini-3.5-transcribe');
assert.strictEqual(capturedGeminiArgs.contents[0].inlineData.mimeType, 'audio/wav');
assert(typeof capturedGeminiArgs.contents[0].inlineData.data === 'string');
assert(capturedGeminiArgs.contents[1].text.includes('conversational Bangladeshi Bengali'));
assert(geminiOutput.includes('📌 *Summary:*'));
assert(geminiOutput.includes('📝 *Full Transcript:*'));

// Test 503 failover: gemini-3.5-transcribe throws 503, fails over to gemini-3.7-flash
let failoverAttempts = [];
ai.models.generateContent = async (args) => {
  failoverAttempts.push(args.model);
  if (args.model === 'gemini-3.5-transcribe') {
    const err = new Error('This model is currently experiencing high demand');
    err.status = 503;
    throw err;
  }
  return {
    text: '📌 *Summary:*\n• সফল ব্যাকআপ মডেল ট্রানজিশন\n\n---\n📝 *Full Transcript:*\nব্যাকআপ মডেল সফলভাবে কাজ করেছে।',
  };
};

fs.writeFileSync(testMockWav, 'RIFF-mock-wav-audio-content');
const failoverOutput = await processAudioWithGemini(testMockWav);
assert(failoverAttempts.includes('gemini-3.5-transcribe'));
assert(failoverAttempts.includes('gemini-3.7-flash'), 'Should have tried gemini-3.7-flash as fallback');
assert(failoverOutput.includes('ব্যাকআপ মডেল'));

// Restore original method
ai.models.generateContent = origGenerateContent;
cleanupFiles(testMockWav);
console.log('✓ processAudioWithGemini multimodal pipeline & 503 fallback verified');

// Test 5: HTTP Server Verification & Webhook Endpoints
console.log('Test 5: HTTP Server Endpoints');

const testPort = 3123;
const serverInstance = app.listen(testPort, async () => {
  try {
    const baseUrl = `http://localhost:${testPort}`;

    // 5a. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'ok');
    console.log('✓ GET /health passed');

    // 5b. GET /webhook with valid challenge
    const challengeParam = 'challenge_test_code_xyz_987';
    const verifyRes = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=my_super_secret_bot_token_2026&hub.challenge=${challengeParam}`
    );
    assert.strictEqual(verifyRes.status, 200);
    const verifyText = await verifyRes.text();
    assert.strictEqual(verifyText, challengeParam);
    console.log('✓ GET /webhook (valid token challenge) passed');

    // 5c. GET /webhook with invalid verify_token
    const invalidVerifyRes = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=${challengeParam}`
    );
    assert.strictEqual(invalidVerifyRes.status, 403);
    console.log('✓ GET /webhook (invalid token) returned 403 Forbidden as expected');

    // 5d. POST /webhook responds 200 EVENT_RECEIVED immediately
    const mockAudioPayload = {
      object: 'page',
      entry: [
        {
          id: '123456789',
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'user_psid_123' },
              recipient: { id: 'page_id_456' },
              timestamp: Date.now(),
              message: {
                mid: 'mid.test.123',
                attachments: [
                  {
                    type: 'audio',
                    payload: {
                      url: 'http://localhost:3123/dummy-audio.mp4',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const postWebhookRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockAudioPayload),
    });
    assert.strictEqual(postWebhookRes.status, 200);
    const postWebhookText = await postWebhookRes.text();
    assert.strictEqual(postWebhookText, 'EVENT_RECEIVED');
    console.log('✓ POST /webhook (immediate 200 EVENT_RECEIVED response) passed');

    // 5e. POST /webhook with non-page object
    const badObjectRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'user' }),
    });
    assert.strictEqual(badObjectRes.status, 404);
    console.log('✓ POST /webhook non-page object returned 404 as expected');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('Test failure:', err);
    process.exit(1);
  } finally {
    serverInstance.close(() => {
      setTimeout(() => process.exit(0), 500);
    });
  }
});
