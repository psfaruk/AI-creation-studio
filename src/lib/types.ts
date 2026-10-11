// ============================================================
// SHARED CONTRACT — Agentic AI Chat System
// এই ফাইলটি frontend ও backend উভয়ের জন্য একমাত্র সত্যের উৎস।
// কোনো এজেন্ট পক্ষ চুক্তি ছাড়া এটি পরিবর্তন করবে না।
// ============================================================

export type ToolCategory = 'research' | 'media' | 'vision' | 'audio' | 'memory';

export interface ToolInfo {
  name: string;
  title: string; // Bengali display title
  description: string; // Bengali short description
  icon: string; // lucide icon name
  category: ToolCategory;
}

export const TOOL_CATALOG: ToolInfo[] = [
  {
    name: 'web_search',
    title: 'ওয়েব সার্চ',
    description: 'ইন্টারনেট থেকে সর্বশেষ তথ্য খুঁজে আনে',
    icon: 'Globe',
    category: 'research',
  },
  {
    name: 'read_web_page',
    title: 'ওয়েব পেজ পড়া',
    description: 'নির্দিষ্ট URL-এর পুরো বিষয়বস্তু পড়ে বোঝে',
    icon: 'FileText',
    category: 'research',
  },
  {
    name: 'generate_image',
    title: 'ছবি তৈরি',
    description: 'টেক্সট বর্ণনা থেকে AI দিয়ে নতুন ছবি আঁকে',
    icon: 'ImagePlus',
    category: 'media',
  },
  {
    name: 'search_images',
    title: 'ছবি খোঁজা',
    description: 'ওয়েব থেকে প্রাসঙ্গিক বাস্তব ছবি খুঁজে আনে',
    icon: 'Images',
    category: 'media',
  },
  {
    name: 'analyze_image',
    title: 'ছবি বিশ্লেষণ',
    description: 'ছবি দেখে প্রশ্নের উত্তর দেয়',
    icon: 'ScanEye',
    category: 'vision',
  },
  {
    name: 'text_to_speech',
    title: 'কণ্ঠ তৈরি (TTS)',
    description: 'লেখাকে স্বাভাবিক কণ্ঠের অডিওতে রূপ দেয়',
    icon: 'AudioLines',
    category: 'audio',
  },
  {
    name: 'transcribe_audio',
    title: 'অডিও লিপিবদ্ধকরণ',
    description: 'অডিও শুনে লিখিত রূপে রূপান্তর করে',
    icon: 'Mic',
    category: 'audio',
  },
  {
    name: 'search_conversations',
    title: 'স্মৃতি খোঁজা',
    description: 'পুরনো কথোপকথন থেকে প্রাসঙ্গিক তথ্য খুঁজে আনে',
    icon: 'History',
    category: 'memory',
  },
];

export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted';
export type ActivityStatus = 'running' | 'done' | 'failed';

export interface ArtifactMeta {
  id: string;
  kind: 'image' | 'audio' | 'text';
  mimeType: string;
  fileName: string;
  size: number; // bytes (0 if external)
  url: string; // always /api/artifacts/{id}/file (redirects if external)
  external: boolean; // true → url redirects to a remote image
}

export interface AttachmentView {
  kind: 'image' | 'audio';
  name: string;
  url: string;
}

export interface RunStats {
  steps: number;
  toolCalls: number;
  durationMs: number;
}

export interface ActivityView {
  id: string; // toolCall id
  tool: string; // tool name (key into TOOL_CATALOG)
  title: string; // Bengali title from TOOL_CATALOG
  icon: string;
  status: ActivityStatus;
  input: string; // human-readable summary of arguments
  output?: string; // human-readable summary of result
  error?: string;
  artifacts?: ArtifactMeta[];
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO string
  attachments?: AttachmentView[]; // user-uploaded files
  activities?: ActivityView[]; // tool executions for this assistant turn
  artifacts?: ArtifactMeta[]; // all artifacts produced in this assistant turn
  runStats?: RunStats | null; // assistant messages only
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ChatMessage[];
}

export interface ChatRequest {
  conversationId: string; // '' → backend creates a new conversation
  content: string;
  attachments?: {
    kind: 'image' | 'audio';
    name: string;
    dataUrl: string; // data:...;base64,....
  }[];
}

export interface ChatResponse {
  runId: string;
  conversationId: string;
  userMessage: ChatMessage;
}

// ---------------- SSE events (GET /api/runs/{id}/events) ----------------

export type RunEvent =
  | { type: 'run_started'; runId: string; conversationId: string }
  | {
      type: 'tool_start';
      activityId: string;
      tool: string;
      title: string;
      icon: string;
      input: string;
    }
  | {
      type: 'tool_end';
      activityId: string;
      status: 'done' | 'failed';
      output?: string;
      error?: string;
      artifacts?: ArtifactMeta[];
      durationMs?: number;
    }
  | { type: 'message'; conversationId: string; message: ChatMessage }
  | {
      type: 'run_finished';
      runId: string;
      conversationId: string;
      status: RunStatus;
      error?: string;
    }
  | { type: 'ping' };
