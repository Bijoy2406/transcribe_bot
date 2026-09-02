import fs from 'fs';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Setup FFmpeg path: check custom FFMPEG_PATH first, then system /usr/bin/ffmpeg (Alpine/Docker), then installer fallback
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
} else if (fs.existsSync('/usr/bin/ffmpeg')) {
  ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
} else if (ffmpegInstaller && ffmpegInstaller.path && fs.existsSync(ffmpegInstaller.path)) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

const TEMP_DIR = path.resolve(process.cwd(), 'temp');

/**
 * Ensures that the temporary directory exists.
 */
export function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  return TEMP_DIR;
}

/**
 * Downloads an audio file from a given URL to a destination path using a stream.
 * @param {string} url - Audio URL (Meta attachment URL or external URL)
 * @param {string} destinationPath - Target local file path
 * @returns {Promise<string>} - Resolves with destinationPath
 */
export async function downloadAudio(url, destinationPath) {
  ensureTempDir();

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 30000,
    headers: {
      'User-Agent': 'Messenger-Transcribe-Bot/1.0',
    },
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);

    writer.on('finish', () => resolve(destinationPath));
    writer.on('error', (err) => {
      writer.close();
      reject(new Error(`Failed to write downloaded audio: ${err.message}`));
    });
    response.data.on('error', (err) => {
      writer.close();
      reject(new Error(`Error downloading audio stream: ${err.message}`));
    });
  });
}

/**
 * Converts any audio input (.mp4, .aac, .ogg, etc.) to a normalized 16kHz mono WAV format.
 * Optimized for Whisper STT processing.
 * @param {string} inputPath - Path to the downloaded input audio
 * @param {string} outputPath - Path to the converted WAV output
 * @returns {Promise<string>} - Resolves with outputPath on success
 */
export function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .toFormat('wav')
      .on('start', (commandLine) => {
        // Log conversion start in debug
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        reject(new Error(`FFmpeg conversion failed: ${err.message} (stderr: ${stderr || 'none'})`));
      })
      .save(outputPath);
  });
}

/**
 * Cleans up temporary files safely using synchronous unlinking with existence checks.
 * @param  {...string} filePaths - Array of file paths to remove
 */
export function cleanupFiles(...filePaths) {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn(`[audioConverter] Cleanup warning for ${filePath}: ${err.message}`);
    }
  }
}

