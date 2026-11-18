import { SpeechLang } from '../types';

export type { SpeechLang };

export interface RecognitionCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (friendlyMessage: string, errorCode?: string) => void;
}

export interface RecognitionInstance {
  start: () => void;
  stop: () => void;
  abort: () => void;
  setLang: (lang: SpeechLang) => void;
}

export class SpeechService {
  private static synth: SpeechSynthesis | null =
    typeof window !== 'undefined' ? window.speechSynthesis : null;
  private static currentUtterance: SpeechSynthesisUtterance | null = null;
  private static isSpeaking: boolean = false;
  private static isMuted: boolean = false;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  static isRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }

  static isMediaRecorderSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  static async getMicrophonePermissionState(): Promise<
    'granted' | 'prompt' | 'denied' | 'unsupported'
  > {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'unsupported';
    }
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        if (
          status.state === 'granted' ||
          status.state === 'prompt' ||
          status.state === 'denied'
        ) {
          return status.state;
        }
      }
    } catch {
      // Safari/some browsers throw on permissions.query({ name: 'microphone' })
    }
    return 'prompt';
  }

  static setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stop();
    }
  }

  static getMuted(): boolean {
    return this.isMuted;
  }

  static getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  static speak(
    text: string,
    onEnd?: () => void,
    rate = 1.0,
    preferredLang: SpeechLang = 'en-US'
  ): boolean {
    if (!this.synth || this.isMuted) {
      onEnd?.();
      return false;
    }

    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Code block omitted from voice playback.')
      .replace(/[#*_`]/g, '')
      .replace(/https?:\/\/\S+/g, 'link');

    if (!cleanText.trim()) {
      onEnd?.();
      return false;
    }

    this.stop();

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = rate;
      utterance.pitch = 1.0;

      const voices = this.getVoices();
      const langPrefix = preferredLang.split('-')[0];
      const matchedVoice =
        voices.find((v) => v.localService && v.lang === preferredLang) ||
        voices.find((v) => v.localService && v.lang.startsWith(langPrefix)) ||
        voices.find((v) => v.lang.startsWith(langPrefix)) ||
        voices.find((v) => v.lang.startsWith('en')) ||
        voices[0];

      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        onEnd?.();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        onEnd?.();
      };

      this.currentUtterance = utterance;
      this.isSpeaking = true;
      this.synth.speak(utterance);
      return true;
    } catch {
      this.isSpeaking = false;
      onEnd?.();
      return false;
    }
  }

  static stop(): void {
    if (!this.synth) return;
    try {
      this.synth.cancel();
      this.isSpeaking = false;
      this.currentUtterance = null;
    } catch {
      // ignore
    }
  }

  static getSpeakingStatus(): boolean {
    return this.isSpeaking;
  }

  // Request microphone permission explicitly before starting speech recognition
  static async requestMicrophonePermission(): Promise<{ granted: boolean; error?: string }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return {
        granted: false,
        error: 'Microphone API is unavailable in this browser context (HTTPS or localhost required).',
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release stream immediately so SpeechRecognition can bind the mic cleanly
      stream.getTracks().forEach((track) => track.stop());
      return { granted: true };
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return {
          granted: false,
          error: 'Microphone permission was denied. Please allow microphone access in browser site settings.',
        };
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return {
          granted: false,
          error: 'No microphone hardware was found on this device.',
        };
      }
      return {
        granted: false,
        error: `Could not access microphone: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  static async transcribeAudioBlob(blob: Blob, speechLang: SpeechLang = 'en-US'): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read recorded microphone audio.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to encode recorded audio.'));
      reader.readAsDataURL(blob);
    });

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: {
          dataUrl,
          mimeType: blob.type || 'audio/webm',
        },
        speechLang,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || `Audio transcription failed (HTTP ${response.status}).`);
    }

    return (payload.text || '').trim();
  }

  private static mapRecognitionError(code: string): string {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone permission denied. Please enable microphone access in your browser.';
      case 'no-speech':
        return 'No speech detected. Try speaking closer to the microphone.';
      case 'audio-capture':
        return 'No microphone detected on this device.';
      case 'network':
        return 'Browser speech recognition service is unreachable; switching to AI audio recording.';
      case 'aborted':
        return 'Voice recognition stopped.';
      default:
        return `Voice recognition error (${code}). Please try again.`;
    }
  }

  static createRecognition(
    callbacks: RecognitionCallbacks,
    initialLang: SpeechLang = 'en-US'
  ): RecognitionInstance | null {
    if (typeof window === 'undefined') return null;
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) return null;

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = initialLang;

      recognition.onstart = () => {
        callbacks.onStart?.();
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        if (interimTranscript && callbacks.onInterim) {
          callbacks.onInterim(interimTranscript);
        }
        if (finalTranscript.trim()) {
          callbacks.onFinal(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        const code = event?.error || 'unknown';
        callbacks.onError?.(this.mapRecognitionError(code), code);
      };

      recognition.onend = () => {
        callbacks.onEnd?.();
      };

      return {
        start: () => recognition.start(),
        stop: () => recognition.stop(),
        abort: () => recognition.abort(),
        setLang: (lang: SpeechLang) => {
          recognition.lang = lang;
        },
      };
    } catch {
      return null;
    }
  }
}
