# Base image with Node.js 20 on lightweight Alpine Linux
FROM node:20-alpine

# Install system-level FFmpeg for audio normalization (16kHz mono WAV)
RUN apk add --no-cache ffmpeg

# Set working directory inside container
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy application source code
COPY . .

# Create temp directory for temporary audio files
RUN mkdir -p temp

# Koyeb default container port (also configurable via PORT env var)
EXPOSE 8000

# Run the Messenger bot application
CMD ["node", "src/server.js"]

