import axios from 'axios';

const META_GRAPH_URL = 'https://graph.facebook.com/v20.0/me/messages';
const MAX_MESSAGE_LENGTH = 1900; // Meta limit is 2000 characters; capped at 1900 for safety

/**
 * Splits text into chunks of at most maxLength characters, respecting paragraph and word boundaries.
 * @param {string} text - Message text to split
 * @param {number} maxLength - Maximum length per chunk (default: 1900)
 * @returns {string[]} - Array of chunks
 */
export function chunkMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
  if (!text || text.length <= maxLength) {
    return [text || ''];
  }

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try finding boundary points: double newline, single newline, or space within maxLength
    let splitIndex = -1;
    const window = remaining.slice(0, maxLength);

    const doubleNewlineIdx = window.lastIndexOf('\n\n');
    if (doubleNewlineIdx > maxLength * 0.4) {
      splitIndex = doubleNewlineIdx;
    } else {
      const singleNewlineIdx = window.lastIndexOf('\n');
      if (singleNewlineIdx > maxLength * 0.4) {
        splitIndex = singleNewlineIdx;
      } else {
        const spaceIdx = window.lastIndexOf(' ');
        if (spaceIdx > maxLength * 0.3) {
          splitIndex = spaceIdx;
        } else {
          // Hard split if no suitable whitespace
          splitIndex = maxLength;
        }
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * Formats the final outbound message based on transcript and optional summary.
 * @param {object} params
 * @param {string} params.transcript - Full transcription text
 * @param {string|null} params.summary - Optional AI summary bullet points
 * @returns {string} - Formatted message
 */
export function formatResponse({ transcript, summary }) {
  if (summary) {
    return `📌 **Summary:**\n${summary}\n\n---\n📝 **Full Transcript:**\n${transcript}`;
  }
  return `📝 **Full Transcript:**\n${transcript}`;
}

/**
 * Sends a single text message to a recipient via Meta Graph API.
 * @param {string} recipientId - PSID of recipient
 * @param {string} text - Text to send
 * @returns {Promise<object>} - Meta API response data
 */
export async function sendTextMessage(recipientId, text) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    throw new Error('PAGE_ACCESS_TOKEN is not configured.');
  }

  const payload = {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: 'RESPONSE',
  };

  const response = await axios.post(META_GRAPH_URL, payload, {
    params: { access_token: pageAccessToken },
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data;
}

/**
 * Sends a sender action (e.g. mark_seen, typing_on, typing_off) to the recipient.
 * Fails gracefully without throwing to avoid interrupting main flow.
 * @param {string} recipientId - PSID of recipient
 * @param {'mark_seen' | 'typing_on' | 'typing_off'} action - Sender action
 */
export async function sendSenderAction(recipientId, action) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return;

  try {
    await axios.post(
      META_GRAPH_URL,
      {
        recipient: { id: recipientId },
        sender_action: action,
      },
      {
        params: { access_token: pageAccessToken },
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    // Non-critical, ignore error
  }
}

/**
 * Dispatches a formatted message string with automatic chunking (<= 1900 chars).
 * @param {string} recipientId - PSID of recipient
 * @param {string} messageText - Full text to send
 */
export async function dispatchFormattedMessage(recipientId, messageText) {
  const chunks = chunkMessage(messageText, MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    await sendTextMessage(recipientId, chunk);
  }
}

/**
 * Dispatches the formatted transcription and summary to the user, handling chunking if over 1900 chars.
 * @param {string} recipientId - PSID of recipient
 * @param {object|string} params - Object with { transcript, summary } or direct string
 */
export async function dispatchTranscription(recipientId, params) {
  if (typeof params === 'string') {
    return dispatchFormattedMessage(recipientId, params);
  }
  const formatted = formatResponse(params);
  return dispatchFormattedMessage(recipientId, formatted);
}

