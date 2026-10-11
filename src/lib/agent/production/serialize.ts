// ============================================================
// Production serializers — Prisma rows → ProductionView /
// ProductionSummary (shared contract মেনে)।
// ============================================================

import type {
  ArtifactMeta,
  ProductionStatus,
  ProductionStepView,
  ProductionSummary,
  ProductionType,
  ProductionView,
} from '@/lib/types';
import type { Artifact, Production, ProductionStep } from '@prisma/client';
import type { CreativeJobSpec } from '@/lib/types';

export function toStepView(step: ProductionStep): ProductionStepView {
  return {
    id: step.id,
    seq: step.seq,
    key: step.key,
    title: step.title,
    status: (['pending', 'running', 'done', 'failed', 'skipped'] as const).includes(step.status as any)
      ? (step.status as ProductionStepView['status'])
      : 'pending',
    detail: step.detail ?? undefined,
    error: step.error ?? undefined,
    durationMs:
      step.startedAt && step.finishedAt ? Math.max(0, step.finishedAt.getTime() - step.startedAt.getTime()) : undefined,
  };
}

export function toProductionArtifactMeta(a: Artifact): ArtifactMeta {
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

const TERMINAL: ProductionStatus[] = ['completed', 'failed', 'partial', 'cancelled'];

export function toProductionStatus(status: string): ProductionStatus {
  return ([
    'awaiting_confirmation',
    'queued',
    'running',
    'validating',
    'completed',
    'failed',
    'partial',
    'cancelled',
    'cancelling',
  ] as const).includes(status as any)
    ? (status as ProductionStatus)
    : 'failed';
}

export function toProductionView(
  production: Production,
  steps: ProductionStep[],
  artifacts: Artifact[]
): ProductionView {
  let spec: CreativeJobSpec;
  try {
    spec = JSON.parse(production.specJson) as CreativeJobSpec;
  } catch {
    spec = { type: production.type as ProductionType, title: production.title, quality: 'standard' };
  }
  return {
    id: production.id,
    conversationId: production.conversationId,
    type: production.type as ProductionType,
    title: production.title,
    status: toProductionStatus(production.status),
    spec,
    progress: production.progress,
    currentStepKey: production.currentStepKey ?? undefined,
    error: production.error ?? undefined,
    resultJson: production.resultJson ?? undefined,
    parentProductionId: production.parentProductionId ?? undefined,
    createdAt: production.createdAt.toISOString(),
    startedAt: production.startedAt?.toISOString(),
    finishedAt: production.finishedAt?.toISOString(),
    steps: steps.sort((a, b) => a.seq - b.seq).map(toStepView),
    artifacts: artifacts.map(toProductionArtifactMeta),
  };
}

export function toProductionSummary(
  production: Production,
  artifactCount: number
): ProductionSummary {
  return {
    id: production.id,
    type: production.type as ProductionType,
    title: production.title,
    status: toProductionStatus(production.status),
    progress: production.progress,
    createdAt: production.createdAt.toISOString(),
    finishedAt: production.finishedAt?.toISOString(),
    artifactCount,
  };
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.includes(status as any);
}
