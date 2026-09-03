import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Complete list of all active Gemini 3 audio-capable models in priority order
const MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];

function extractCleanText(response) {
  if (response?.candidates?.[0]?.content?.parts) {
    const textParts = response.candidates[0].content.parts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (textParts) return textParts;
  }
  return response?.text || '';
}

async function callGemini(modelName, base64Audio) {
  return await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: base64Audio,
        },
      },
      {
        text: `You are an expert transcriber specialized in conversational Bangladeshi Bengali and Banglish.

Tasks:
1. Accurately transcribe the spoken voice message verbatim in natural Bangla script (keep standard English for loanwords).
2. If the message is longer than 20 seconds, provide a 2-3 bullet point summary in Bengali at the top. If short, omit the summary section.

Output format strictly:
📌 *Summary:*
• <bullet 1>
• <bullet 2>

---
📝 *Full Transcript:*
<Accurate Bengali transcript>`,
      },
    ],
  });
}

export async function processAudioWithGemini(audioFilePath) {
  const audioBytes = fs.readFileSync(audioFilePath);
  const base64Audio = audioBytes.toString('base64');

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[AI Service] Routing to ${model} (attempt ${attempt})...`);
        const response = await callGemini(model, base64Audio);
        const textOutput = extractCleanText(response);

        if (textOutput) {
          return textOutput;
        }
      } catch (error) {
        const isHighDemand =
          error?.status === 503 ||
          error?.message?.includes('high demand') ||
          error?.message?.includes('UNAVAILABLE');

        console.warn(`[AI Service] ${model} attempt ${attempt} failed: ${error?.message || error}`);

        if (isHighDemand) {
          // Wait 2s on attempt 1, 3.5s on attempt 2 + random jitter to clear queue
          const delay = attempt * 1800 + Math.floor(Math.random() * 400);
          await new Promise((res) => setTimeout(res, delay));
        } else {
          // If error is 404 (model not found) or invalid payload, skip immediately to next model
          break;
        }
      }
    }
  }

  throw new Error('All Gemini transcription endpoints are currently busy. Please send your voice note again in a few seconds.');
}

export const transcribeAndProcessAudio = processAudioWithGemini;
export { ai, MODELS };
