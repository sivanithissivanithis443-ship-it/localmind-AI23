import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  buildChatContents,
  buildSystemInstruction,
  generateUniversalAnswer,
  IncomingChatRequest,
  IncomingTranscribeRequest,
  transcribeSpokenAudio,
} from './lib/aiServer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      app: 'LocalMind',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Streaming Universal AI Endpoint (SSE)
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the backend. Please add your Gemini API key in the Settings > Secrets panel to enable Universal AI answers.',
      });
    }

    const body = (req.body || {}) as IncomingChatRequest;
    const built = buildChatContents(body);
    if (built.error || !built.contents) {
      return res.status(built.error?.status || 400).json({
        error: built.error?.message || 'A question or image is required.',
      });
    }

    const systemInstruction = buildSystemInstruction(body.language, body.explanationDepth);

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': stream-open\n\n');

    const answer = await generateUniversalAnswer({
      apiKey,
      contents: built.contents,
      systemInstruction,
      isCancelled: () => clientClosed,
    });

    if (clientClosed) return;

    if (answer.error || !answer.text) {
      res.write(
        `data: ${JSON.stringify({ error: answer.error?.message || 'AI response unavailable.' })}\n\n`
      );
      res.end();
      return;
    }

    // Stream response chunks over SSE cleanly
    const pieces = answer.text.split(/(\s+)/);
    const batchSize = 4;
    for (let i = 0; i < pieces.length; i += batchSize) {
      if (clientClosed) break;
      const delta = pieces.slice(i, i + batchSize).join('');
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      await new Promise((r) => setTimeout(r, 12));
    }

    if (!clientClosed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  });

  // Audio Transcription Endpoint for Universal Microphone Access
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the backend. Please add your Gemini API key in Settings > Secrets.',
      });
    }

    const body = (req.body || {}) as IncomingTranscribeRequest;
    const result = await transcribeSpokenAudio({ apiKey, body });
    if (result.error) {
      return res.status(result.error.status).json({ error: result.error.message });
    }

    return res.json({ text: result.text || '' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const fs = await import('fs');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LocalMind Universal AI server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
