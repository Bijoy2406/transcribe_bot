import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function processAudioWithGemini(audioFilePath) {
  try {
    const audioBytes = fs.readFileSync(audioFilePath);
    const base64Audio = audioBytes.toString('base64');

    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const response = await ai.models.generateContent({
      model,
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

    return response.text;
  } catch (error) {
    console.error('Gemini audio processing error:', error);
    throw error;
  }
}

export const transcribeAndProcessAudio = processAudioWithGemini;
export { ai };
