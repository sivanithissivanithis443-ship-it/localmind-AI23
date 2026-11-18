import { ChatMessage, ExplanationDepth, ImageAttachment, LanguagePreference } from '../types';

export interface StreamAnswerParams {
  prompt: string;
  history: ChatMessage[];
  image?: ImageAttachment | null;
  language: LanguagePreference;
  explanationDepth: ExplanationDepth;
  signal?: AbortSignal;
  onToken: (fullTextSoFar: string) => void;
}

export class AIChatService {
  static async streamAnswer(params: StreamAnswerParams): Promise<string> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(
        'You appear to be offline. LocalMind Universal AI requires an internet connection to reach the AI inference backend.'
      );
    }

    const formattedHistory = params.history
      .filter((m) => !m.isError && (m.text.trim() || m.image))
      .slice(-14)
      .map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('model' as const),
        text: m.text,
        imageDataUrl: m.sender === 'user' ? m.image?.dataUrl : undefined,
      }));

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        history: formattedHistory,
        image: params.image
          ? {
              dataUrl: params.image.dataUrl,
              mimeType: params.image.mimeType,
            }
          : null,
        language: params.language,
        explanationDepth: params.explanationDepth,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      let errMsg = `AI request failed (HTTP ${response.status}).`;
      try {
        const json = (await response.json()) as { error?: string };
        if (json.error) errMsg = json.error;
      } catch {
        // ignore JSON parse failure
      }
      throw new Error(errMsg);
    }

    if (!response.body) {
      throw new Error('Streaming response body was unavailable from the server.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const evt of events) {
        const lines = evt.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payloadStr = line.slice(6).trim();
          if (!payloadStr) continue;

          let payload: { delta?: string; done?: boolean; error?: string };
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          if (payload.error) {
            throw new Error(payload.error);
          }
          if (payload.delta) {
            accumulated += payload.delta;
            params.onToken(accumulated);
          }
        }
      }
    }

    if (!accumulated.trim()) {
      throw new Error('The AI service returned an empty response. Please try again.');
    }

    return accumulated;
  }
}
