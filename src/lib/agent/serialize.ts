// ============================================================
// Serializers — Prisma rows → shared-contract view types
// (ChatMessage / ActivityView / ArtifactMeta / RunStats)।
// Orchestrator-এর SSE 'message' ইভেন্ট ও API routes দুই জায়গাতেই ব্যবহৃত।
// ============================================================

import type {
  ActivityView,
  ArtifactMeta,
  AttachmentView,
  ChatMessage,
  RunStats,
  RunStatus,
} from '@/lib/types';
import { TOOL_CATALOG } from '@/lib/types';
import { db } from '@/lib/db';
import type { AgentRun, Artifact, Message, ToolCall } from '@prisma/client';

/** user_upload Artifact row → AttachmentView */
export function toAttachmentView(a: Artifact): AttachmentView {
  return {
    kind: a.kind as AttachmentView['kind'],
    name: a.fileName,
    url: `/api/artifacts/${a.id}/file`,
  };
}

/** ToolCall row → ActivityView (title/icon TOOL_CATALOG থেকে) */
export function toActivityView(tc: ToolCall): ActivityView {
  const cat = TOOL_CATALOG.find(t => t.name === tc.tool);
  return {
    id: tc.id,
    tool: tc.tool,
    title: cat?.title ?? tc.tool,
    icon: cat?.icon ?? 'Wrench',
    status: tc.status as ActivityView['status'],
    input: tc.inputSummary,
    output: tc.outputSummary ?? undefined,
    error: tc.error ?? undefined,
    durationMs: tc.durationMs ?? undefined,
  };
}

/** Artifact row → ArtifactMeta (url সবসময় লোকাল API endpoint) */
export function toArtifactMeta(a: Artifact): ArtifactMeta {
  return {
    id: a.id,
    kind: a.kind as ArtifactMeta['kind'],
    mimeType: a.mimeType,
    fileName: a.fileName,
    size: a.size,
    url: `/api/artifacts/${a.id}/file`,
    external: !a.storagePath && !!a.sourceUrl,
  };
}

/** AgentRun row → RunStats */
export function toRunStats(run: AgentRun): RunStats {
  return {
    steps: run.stepCount,
    toolCalls: run.toolCallCount,
    durationMs: run.durationMs ?? 0,
  };
}

/** AgentRun.status string → RunStatus */
export function toRunStatus(status: string): RunStatus {
  return status === 'completed' || status === 'failed' || status === 'interrupted'
    ? status
    : 'running';
}

/**
 * Message row → full ChatMessage view।
 * - user message → attachments (user_upload artifacts)
 * - assistant message → activities + artifacts + runStats (run থেকে, runId ম্যাপিং)
 */
export async function buildMessageView(msg: Message): Promise<ChatMessage> {
  const base: ChatMessage = {
    id: msg.id,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
    productionId: msg.productionId ?? undefined,
  };

  if (base.role === 'user') {
    const uploads = await db.artifact.findMany({
      where: { messageId: msg.id, origin: 'user_upload' },
      orderBy: { createdAt: 'asc' },
    });
    if (uploads.length > 0) {
      base.attachments = uploads.map(toAttachmentView);
    }
    return base;
  }

  if (msg.runId) {
    const [run, toolCalls, artifacts] = await Promise.all([
      db.agentRun.findUnique({ where: { id: msg.runId } }),
      db.toolCall.findMany({ where: { runId: msg.runId }, orderBy: { createdAt: 'asc' } }),
      db.artifact.findMany({
        where: { runId: msg.runId, origin: 'tool' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (toolCalls.length > 0) {
      base.activities = toolCalls.map(toActivityView);
    }
    if (artifacts.length > 0) {
      base.artifacts = artifacts.map(toArtifactMeta);
    }
    if (run) {
      base.runStats = toRunStats(run);
    }
  }
  return base;
}
