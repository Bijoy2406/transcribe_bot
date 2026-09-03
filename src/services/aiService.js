import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Prioritize Google's dedicated speech-to-text audio endpoint
const MODELS = [
  'gemini-3.5-transcribe',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
];

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
1. Accurately transcribe the spoken voice message verbatim in natural Bangla script.
2. If the message has substantive content or is longer than 20 seconds, provide a 2-3 bullet point summary in Bengali at the top. If short, omit the summary.

Output format strictly:
📌 *Summary:*
• 
• 

---
📝 *Full Transcript:*
`,
      },
    ],
  });
}

export async function processAudioWithGemini(audioFilePath) {
  const audioBytes = fs.readFileSync(audioFilePath);
  const base64Audio = audioBytes.toString('base64');

  for (const model of MODELS) {
    try {
      console.log(`Routing audio to: ${model}`);
      const response = await callGemini(model, base64Audio);
      if (response && response.text) {
        return response.text;
      }
    } catch (error) {
      console.warn(`Model ${model} failed (${error?.status || '503'}): ${error?.message || error}`);
      // Short delay before hitting the next endpoint
      await new Promise((res) => setTimeout(res, 800));
    }
  }

  throw new Error('All speech transcription endpoints are temporarily busy. Please retry shortly.');
}

export const transcribeAndProcessAudio = processAudioWithGemini;
export { ai, MODELS };
