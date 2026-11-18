import type { IncomingMessage, ServerResponse } from 'http';
import { IncomingTranscribeRequest, transcribeSpokenAudio } from '../lib/aiServer';

export const config = {
  maxDuration: 30,
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

  let body: IncomingTranscribeRequest;
  try {
    body = await readJsonBody<IncomingTranscribeRequest>(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON request body.' });
  }

  const result = await transcribeSpokenAudio({ apiKey, body });
  if (result.error) {
    return sendJson(res, result.error.status, { error: result.error.message });
  }

  return sendJson(res, 200, { text: result.text || '' });
}
