export type MessageSender = 'user' | 'assistant';

export type ThemeMode = 'dark' | 'light';

export type LanguagePreference = 'auto' | 'english' | 'tamil' | 'tanglish';

export type ExplanationDepth = 'standard' | 'simple';

export type SpeechLang = 'en-US' | 'en-IN' | 'ta-IN';

export type AssistantVisualState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface ImageAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  ocrText?: string;
  ocrConfidence?: number;
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  text: string;
  timestamp: number;
  topicCategory?: string;
  topicId?: string;
  isStreaming?: boolean;
  isError?: boolean;
  image?: ImageAttachment;
  liked?: boolean | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface AppSettings {
  language: LanguagePreference;
  explanationDepth: ExplanationDepth;
  speechLang: SpeechLang;
  autoSpeak: boolean;
  ttsMuted: boolean;
  ttsRate: number;
  theme: ThemeMode;
}
