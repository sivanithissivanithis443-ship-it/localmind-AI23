import type { IncomingMessage, ServerResponse } from 'http';
import {
  buildChatContents,
  buildSystemInstruction,
  generateUniversalAnswer,
  IncomingChatRequest,
} from '../../lib/aiServer';

export const config = {
  maxDuration: 60,
};

type VercelRequest = IncomingMessage & { body?: unknown };

async function readJsonBody<T>(req: VercelRequest): Promise<T> {
  if (req.body && typeof req.body === 'object') {
    return req.body as T;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body) as T;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, {
      error:
        'GEMINI_API_KEY is not configured. Please add GEMINI_API_KEY in your Vercel Project Environment Variables.',
    });
  }

  let body: IncomingChatRequest;
  try {
    body = await readJsonBody<IncomingChatRequest>(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON request body.' });
  }

  const built = buildChatContents(body);
  if (built.error || !built.contents) {
    return sendJson(res, built.error?.status || 400, {
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

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
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
}
