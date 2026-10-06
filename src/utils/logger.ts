import pino from 'pino';
import { EventEmitter } from 'events';
import { config } from '../config/index.js';

// Event emitter for real-time log streaming (SSE)
export const logStreamEmitter = new EventEmitter();

// Custom stream to intercept logs and emit them for real-time viewers
const emitStream = {
  write: (msg: string) => {
    try {
      const parsed = JSON.parse(msg);
      logStreamEmitter.emit('log', parsed);
    } catch {
      // Ignore parsing errors for streaming
    }
  }
};


// Since we cannot easily mix pino.transport with custom streams directly without multidirectional streams,
// we'll hook into Pino's multi-stream or use a custom write destination. For simplicity in this env:
const streams = [
  { stream: process.stdout },
  { stream: emitStream }
];

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['password', 'token', 'secret', 'apiKey', 'authorization'],
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  },
  pino.multistream(streams)
);
