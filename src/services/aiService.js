import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// List of fallback models in priority order
const MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

async function callGeminiWithModel(modelName, base64Audio) {
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
        text: `You are an expert transcriber specialized in conversational Bangladeshi Bengali, standard Bangla, and Banglish (code-mixed Bengali-English).

Tasks:
1. Accurately transcribe the spoken voice message verbatim in natural Bangla script (use standard English for loanwords/Banglish phrases).
2. If the message has substantive content or is longer than 20 seconds, provide a 2-3 bullet point summary in Bengali at the top. If short, omit the summary.

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

  // Try available models sequentially if one is experiencing high demand (503) or error
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Attempting transcription with model: ${model} (attempt ${attempt})`);
        const response = await callGeminiWithModel(model, base64Audio);
        return response.text;
      } catch (error) {
        console.warn(`Model ${model} attempt ${attempt} failed:`, error?.message || error);
        // If 503 or overloaded, wait 1.5s before next attempt
        if (error?.status === 503 || error?.message?.includes('high demand') || error?.message?.includes('503')) {
          await new Promise((res) => setTimeout(res, 1500));
        } else {
          break; // For non-503 errors (like 404), skip immediately to next model
        }
      }
    }
  }

  throw new Error('All Gemini transcription models are currently busy. Please try again in a few moments.');
}

export const transcribeAndProcessAudio = processAudioWithGemini;
export { ai, MODELS };
