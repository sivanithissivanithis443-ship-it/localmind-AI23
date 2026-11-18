import { GoogleGenAI, Content, Part } from '@google/genai';

export const PRIMARY_TEXT_MODEL = 'gemini-3.8-flash';
export const FALLBACK_TEXT_MODEL = 'gemini-3.5-flash-lite';
export const TRANSCRIBE_MODELS = ['gemini-3.5-transcribe', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];

export interface IncomingHistoryItem {
  role: 'user' | 'model';
  text: string;
  imageDataUrl?: string;
}

export interface IncomingChatRequest {
  prompt?: string;
  history?: IncomingHistoryItem[];
  image?: {
    dataUrl: string;
    mimeType?: string;
  } | null;
  language?: 'auto' | 'english' | 'tamil' | 'tanglish';
  explanationDepth?: 'standard' | 'simple';
}

export interface IncomingTranscribeRequest {
  audio?: {
    dataUrl?: string;
    mimeType?: string;
  };
  speechLang?: string;
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function parseDataUrl(
  dataUrl: string,
  fallbackMime = 'image/jpeg'
): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || fallbackMime,
    data: match[2],
  };
}

export function buildSystemInstruction(
  language: string = 'auto',
  explanationDepth: string = 'standard'
): string {
  const langRule =
    language === 'tamil'
      ? 'Respond clearly in natural Tamil script (தமிழ்), using clear formatting and keeping code/math notation readable.'
      : language === 'tanglish'
      ? 'Respond primarily in natural, easy-to-understand Tanglish (Tamil written in English script), keeping code and math formulas standard.'
      : language === 'english'
      ? 'Respond in clear, accurate English.'
      : 'Support English, Tamil (தமிழ்), and Tanglish seamlessly: match the language and script the user writes in.';

  const depthRule =
    explanationDepth === 'simple'
      ? 'Explain concepts in simple, beginner-friendly language using everyday analogies and short step-by-step points.'
      : 'Provide complete, accurate, well-structured answers with clear examples and step-by-step explanations when helpful.';

  return [
    'You are LocalMind, a universal, intelligent AI assistant.',
    'Answer any topic dynamically: Science and Technology, Mathematics and Calculations, Environmental Science, Computer Science, Programming and Coding, Engineering subjects, History and Geography, General Knowledge, Education and Exam Questions, Daily Life Questions, Definitions, and open-ended queries.',
    'Understand the full meaning and context of every question, remember earlier turns in the conversation, and answer follow-up questions accurately.',
    langRule,
    depthRule,
    'When writing code (C, C++, Java, Python, HTML, CSS, JavaScript, TypeScript, SQL, etc.), wrap it in fenced markdown blocks with the language tag.',
    'When an image is provided, inspect it carefully to extract text, solve math or exam questions, explain diagrams/charts, or debug code.',
    'If something is genuinely ambiguous or uncertain, explain the uncertainty honestly instead of fabricating facts.',
  ].join(' ');
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|403/i.test(raw)) {
    return {
      status: 403,
      message:
        'The Gemini API key was rejected or lacks permission. Please verify GEMINI_API_KEY in your environment variables or Settings > Secrets.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      message:
        'AI request quota has been reached temporarily. Please wait a moment and try again.',
    };
  }
  if (/NOT_FOUND|404/i.test(raw)) {
    return {
      status: 404,
      message: `Requested AI model (${PRIMARY_TEXT_MODEL}) was not found or is unavailable right now.`,
    };
  }
  return {
    status: 500,
    message: `AI service error: ${raw}`,
  };
}

export function buildChatContents(
  body: IncomingChatRequest
): { contents?: Content[]; error?: { status: number; message: string } } {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const hasImage = Boolean(body.image?.dataUrl);

  if (!prompt && !hasImage) {
    return { error: { status: 400, message: 'A question or image is required.' } };
  }

  const contents: Content[] = [];
  if (Array.isArray(body.history)) {
    for (const turn of body.history.slice(-14)) {
      if (!turn || (turn.role !== 'user' && turn.role !== 'model')) continue;
      const parts: Part[] = [];
      if (turn.role === 'user' && turn.imageDataUrl) {
        const parsedHistImg = parseDataUrl(turn.imageDataUrl);
        if (parsedHistImg) {
          parts.push({ inlineData: parsedHistImg });
        }
      }
      if (typeof turn.text === 'string' && turn.text.trim()) {
        parts.push({ text: turn.text.trim() });
      }
      if (parts.length > 0) {
        contents.push({ role: turn.role, parts });
      }
    }
  }

  const currentParts: Part[] = [];
  if (body.image?.dataUrl) {
    const parsedImg = parseDataUrl(body.image.dataUrl, body.image.mimeType || 'image/jpeg');
    if (!parsedImg) {
      return {
        error: {
          status: 400,
          message: 'Invalid image encoding. Please attach a valid PNG, JPG, or WEBP image.',
        },
      };
    }
    currentParts.push({ inlineData: parsedImg });
  }

  currentParts.push({
    text:
      prompt ||
      'Analyze this image carefully. If it contains questions, math problems, code, diagrams, or handwritten notes, explain or solve them step by step.',
  });
  contents.push({ role: 'user', parts: currentParts });

  return { contents };
}

export async function generateUniversalAnswer(params: {
  apiKey: string;
  contents: Content[];
  systemInstruction: string;
  isCancelled?: () => boolean;
}): Promise<{ text?: string; error?: { status: number; message: string } }> {
  const ai = createGeminiClient(params.apiKey);
  const candidateModels = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let fullText = '';
  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    if (params.isCancelled?.()) break;
    try {
      const result = await Promise.race([
        ai.models.generateContent({
          model: candidateModel,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API request timed out.')), 15000)
        ),
      ]);

      fullText = result.text || '';
      if (fullText.trim()) break;
    } catch (err: unknown) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (/400|403|API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMsg)) {
        break;
      }
    }
  }

  if (!fullText.trim()) {
    return {
      error: lastError
        ? formatGeminiError(lastError)
        : {
            status: 500,
            message: 'The AI service returned an empty response. Please try rephrasing your question.',
          },
    };
  }

  return { text: fullText };
}

export async function transcribeSpokenAudio(params: {
  apiKey: string;
  body: IncomingTranscribeRequest;
}): Promise<{ text?: string; error?: { status: number; message: string } }> {
  const dataUrl = params.body.audio?.dataUrl;
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { error: { status: 400, message: 'Recorded audio data is required.' } };
  }

  const parsed = parseDataUrl(dataUrl, params.body.audio?.mimeType || 'audio/webm');
  if (!parsed) {
    return { error: { status: 400, message: 'Invalid audio encoding.' } };
  }

  const normalizedMime = parsed.mimeType.split(';')[0].trim() || 'audio/webm';
  const ai = createGeminiClient(params.apiKey);

  const langHint =
    params.body.speechLang === 'ta-IN'
      ? 'The speaker may be speaking Tamil (தமிழ்), Tanglish, or English.'
      : params.body.speechLang === 'en-IN'
      ? 'The speaker may be speaking Indian English, Tanglish, or Tamil.'
      : 'The speaker may be speaking English, Tamil, or Tanglish.';

  const audioPart: Part = {
    inlineData: {
      mimeType: normalizedMime,
      data: parsed.data,
    },
  };
  const promptPart: Part = {
    text: `Transcribe ONLY the exact spoken words in this audio into plain text, with no commentary or timestamps. ${langHint} If the audio is silent, noise-only, or has no clear spoken words, output nothing (empty text) and do not invent words.`,
  };

  let transcript = '';
  let lastError: unknown = null;

  for (const model of TRANSCRIBE_MODELS) {
    try {
      const result = await Promise.race([
        ai.models.generateContent({
          model,
          contents: { parts: [audioPart, promptPart] },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Audio transcription timed out.')), 15000)
        ),
      ]);
      transcript = (result.text || '').trim();
      break;
    } catch (err: unknown) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (/400|403|API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMsg)) {
        break;
      }
    }
  }

  if (!transcript && lastError) {
    return { error: formatGeminiError(lastError) };
  }

  return { text: transcript };
}
