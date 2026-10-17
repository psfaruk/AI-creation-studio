// ============================================================
// Phase-1 test helper — in-memory fake of the Prisma client
// (exact subset of the query shapes used by the code under test:
//  api/chat POST, api/runs/[id]/events GET, agent/serialize).
//
// Isolation contract:
//  - NEVER touches the real SQLite dev database. All rows live in
//    a process-global in-memory store that `resetFakeDb()` clears.
//  - The global singleton pattern means a module cached by an
//    earlier test file still resolves to the same live object.
// ============================================================

export interface FakeConversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface FakeMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  runId: string | null;
  productionId: string | null;
  attachmentsJson: string | null;
  createdAt: Date;
}
export interface FakeAgentRun {
  id: string;
  conversationId: string;
  status: string;
  error: string | null;
  errorCategory: string | null;
  endReason: string | null;
  cacheStatus: string | null;
  requestedMode: string | null;
  stepCount: number;
  toolCallCount: number;
  durationMs: number | null;
  firstTokenMs: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  model: string | null;
  usedModel: string | null;
}
export interface FakeToolCall {
  id: string;
  runId: string;
  tool: string;
  argsJson: string;
  inputSummary: string;
  status: string;
  outputSummary: string | null;
  resultJson: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
}
export interface FakeArtifact {
  id: string;
  conversationId: string;
  runId: string | null;
  productionId: string | null;
  messageId: string | null;
  origin: string;
  kind: string;
  mimeType: string;
  fileName: string;
  size: number;
  storagePath: string | null;
  sourceUrl: string | null;
  metaJson: string | null;
  createdAt: Date;
}
/** Phase-4: প্রোডাকশন-রো (confirm/cancel/validate/config-panel রাউট-টেস্টের জন্য) */
export interface FakeProduction {
  id: string;
  conversationId: string;
  type: string;
  title: string;
  status: string;
  specJson: string;
  progress: number;
  currentStepKey: string | null;
  error: string | null;
  resultJson: string | null;
  parentProductionId: string | null;
  createdAt: Date;
  /** (D-8/B6 — MP4-F) নিশ্চিতকরণের মুহূর্ত; null = ঐতিহাসিক/অ-নিশ্চিত */
  confirmedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** (MP4-F) প্রোডাকশন-ধাপ-রো — SSE-রিপ্লে/রানার-জীবনচক্র টেস্টের জন্য */
export interface FakeProductionStep {
  id: string;
  productionId: string;
  seq: number;
  key: string;
  title: string;
  status: string;
  detail: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface FakeDbState {
  conversations: Map<string, FakeConversation>;
  messages: Map<string, FakeMessage>;
  agentRuns: Map<string, FakeAgentRun>;
  toolCalls: Map<string, FakeToolCall>;
  artifacts: Map<string, FakeArtifact>;
  productions: Map<string, FakeProduction>;
  productionSteps: Map<string, FakeProductionStep>;
  seq: number;
  /** agentRun.create calls — duplicate-submission evidence */
  agentRunCreateCalls: Array<Record<string, unknown>>;
}

const g = globalThis as unknown as { __phase1FakeDb?: FakeDbState };

export function state(): FakeDbState {
  if (!g.__phase1FakeDb) {
    g.__phase1FakeDb = {
      conversations: new Map(),
      messages: new Map(),
      agentRuns: new Map(),
      toolCalls: new Map(),
      artifacts: new Map(),
      productions: new Map(),
      productionSteps: new Map(),
      seq: 0,
      agentRunCreateCalls: [],
    };
  }
  return g.__phase1FakeDb;
}

/** Clear all rows + counters (call in beforeEach for deterministic tests). */
export function resetFakeDb(): void {
  const s = state();
  s.conversations.clear();
  s.messages.clear();
  s.agentRuns.clear();
  s.toolCalls.clear();
  s.artifacts.clear();
  s.productions.clear();
  s.productionSteps.clear();
  s.seq = 0;
  s.agentRunCreateCalls = [];
}

export function nextId(prefix: string): string {
  const s = state();
  s.seq += 1;
  return `${prefix}-${String(s.seq).padStart(4, '0')}`;
}

// ------------------------------------------------------------
// Row factory helpers used by tests to stage scenarios
// ------------------------------------------------------------

export function seedConversation(id = nextId('conv')): FakeConversation {
  const row: FakeConversation = {
    id,
    title: 'নতুন কথোপকথন',
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
  };
  state().conversations.set(id, row);
  return row;
}

export function seedAgentRun(
  conversationId: string,
  overrides: Partial<FakeAgentRun> = {}
): FakeAgentRun {
  const id = overrides.id ?? nextId('run');
  const row: FakeAgentRun = {
    id,
    conversationId,
    status: 'running',
    error: null,
    errorCategory: null,
    endReason: null,
    cacheStatus: null,
    requestedMode: null,
    stepCount: 0,
    toolCallCount: 0,
    durationMs: null,
    firstTokenMs: null,
    startedAt: new Date(Date.now() - 5_000),
    finishedAt: null,
    model: null,
    usedModel: null,
    ...overrides,
  };
  state().agentRuns.set(id, row);
  return row;
}

export function seedToolCall(
  runId: string,
  tool: string,
  overrides: Partial<FakeToolCall> = {}
): FakeToolCall {
  const id = overrides.id ?? nextId('tc');
  const row: FakeToolCall = {
    id,
    runId,
    tool,
    argsJson: '{}',
    inputSummary: tool,
    status: 'running',
    outputSummary: null,
    resultJson: null,
    error: null,
    durationMs: null,
    createdAt: new Date(Date.now() - 4_000),
    ...overrides,
  };
  state().toolCalls.set(id, row);
  return row;
}

export function seedMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  overrides: Partial<FakeMessage> = {}
): FakeMessage {
  const id = overrides.id ?? nextId('msg');
  const row: FakeMessage = {
    id,
    conversationId,
    role,
    content,
    runId: null,
    productionId: null,
    attachmentsJson: null,
    createdAt: new Date(),
    ...overrides,
  };
  state().messages.set(id, row);
  return row;
}

/** Phase-4: awaiting_confirmation প্রোডাকশন বপন (confirm-flow টেস্ট) */
export function seedProduction(
  conversationId: string,
  spec: Record<string, unknown>,
  overrides: Partial<FakeProduction> = {}
): FakeProduction {
  const id = overrides.id ?? nextId('prod');
  const row: FakeProduction = {
    id,
    conversationId,
    type: String(spec.type ?? 'image'),
    title: String(spec.title ?? 'টেস্ট প্রোডাকশন'),
    status: 'awaiting_confirmation',
    specJson: JSON.stringify(spec),
    progress: 0,
    currentStepKey: null,
    error: null,
    resultJson: null,
    parentProductionId: null,
    createdAt: new Date(Date.now() - 30_000),
    confirmedAt: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
  state().productions.set(id, row);
  return row;
}

/** (MP4-F) প্রোডাকশন-ধাপ বপন — SSE-রিপ্লে/রানার-টেস্টের জন্য।
 *  ডিফল্ট seq = এই প্রোডাকশনের পরবর্তী ক্রমিক। */
export function seedProductionStep(
  productionId: string,
  key: string,
  overrides: Partial<FakeProductionStep> = {}
): FakeProductionStep {
  const id = overrides.id ?? nextId('pstep');
  const existing = [...state().productionSteps.values()].filter(r => r.productionId === productionId);
  const row: FakeProductionStep = {
    id,
    productionId,
    seq: overrides.seq ?? existing.length + 1,
    key,
    title: overrides.title ?? key,
    status: 'done',
    detail: null,
    error: null,
    startedAt: new Date(Date.now() - 5_000),
    finishedAt: new Date(Date.now() - 2_000),
    ...overrides,
  };
  state().productionSteps.set(id, row);
  return row;
}

// ------------------------------------------------------------
// The fake db object itself — Prisma-shaped subset
// ------------------------------------------------------------

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (row[key] !== value) return false;
  }
  return true;
}

function sortedByCreatedAtAsc<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function createFakeDb() {
  const s = state;
  return {
    get __fakeDb(): true {
      return true;
    },
    // observability into duplicate-create behavior
    __agentRunCreateCalls(): Array<Record<string, unknown>> {
      return s().agentRunCreateCalls;
    },
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        s().conversations.get(where.id) ?? null,
      create: async ({ data }: { data: Partial<FakeConversation> }) => {
        const id = nextId('conv');
        const row: FakeConversation = {
          id,
          title: data.title ?? 'নতুন কথোপকথন',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        s().conversations.set(id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeConversation> }) => {
        const row = s().conversations.get(where.id);
        if (!row) throw new Error('fake conversation not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    message: {
      create: async ({ data }: { data: Partial<FakeMessage> }) => {
        const id = nextId('msg');
        const row: FakeMessage = {
          id,
          conversationId: data.conversationId ?? '',
          role: data.role ?? 'user',
          content: data.content ?? '',
          runId: data.runId ?? null,
          productionId: data.productionId ?? null,
          attachmentsJson: data.attachmentsJson ?? null,
          createdAt: new Date(),
        };
        s().messages.set(id, row);
        return row;
      },
      count: async ({ where }: { where: { conversationId: string; role: string } }) => {
        let n = 0;
        for (const row of s().messages.values()) {
          if (matches(row as unknown as Record<string, unknown>, where)) n++;
        }
        return n;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeMessage> }) => {
        const row = s().messages.get(where.id);
        if (!row) throw new Error('fake message not found');
        Object.assign(row, data);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const row of s().messages.values()) {
          if (matches(row as unknown as Record<string, unknown>, where)) return row;
        }
        return null;
      },
    },
    agentRun: {
      create: async ({ data }: { data: Partial<FakeAgentRun> }) => {
        s().agentRunCreateCalls.push({ ...data });
        const id = nextId('run');
        const row: FakeAgentRun = {
          id,
          conversationId: data.conversationId ?? '',
          status: data.status ?? 'running',
          error: null,
          errorCategory: null,
          endReason: null,
          cacheStatus: null,
          requestedMode: data.requestedMode ?? null,
          stepCount: 0,
          toolCallCount: 0,
          durationMs: null,
          firstTokenMs: null,
          startedAt: new Date(),
          finishedAt: null,
          model: data.model ?? null,
          usedModel: null,
        };
        s().agentRuns.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        s().agentRuns.get(where.id) ?? null,
      /** P0-BUG-03/REG-3 guard — active-run lookup (supports startedAt orderBy) */
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { startedAt?: 'asc' | 'desc' };
      }) => {
        const rows = [...s().agentRuns.values()].filter((row) =>
          matches(row as unknown as Record<string, unknown>, where)
        );
        // orderBy না দিলে সাম্প্রতিক-প্রথম (গার্ডের কাছে দরকারিটা সাম্প্রতিকটাই)
        const dir = orderBy?.startedAt === 'asc' ? 1 : -1;
        rows.sort((a, b) => (a.startedAt.getTime() - b.startedAt.getTime()) * dir);
        return rows[0] ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeAgentRun> }) => {
        const row = s().agentRuns.get(where.id);
        if (!row) throw new Error('fake agentRun not found');
        Object.assign(row, data);
        return row;
      },
    },
    toolCall: {
      create: async ({ data }: { data: Partial<FakeToolCall> }) => {
        const id = nextId('tc');
        const row: FakeToolCall = {
          id,
          runId: data.runId ?? '',
          tool: data.tool ?? '',
          argsJson: data.argsJson ?? '{}',
          inputSummary: data.inputSummary ?? '',
          status: data.status ?? 'running',
          outputSummary: null,
          resultJson: null,
          error: null,
          durationMs: null,
          createdAt: new Date(),
          ...data,
        } as FakeToolCall;
        s().toolCalls.set(id, row);
        return row;
      },
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
        const rows = [...s().toolCalls.values()].filter((row) =>
          matches(row as unknown as Record<string, unknown>, where)
        );
        return orderBy ? sortedByCreatedAtAsc(rows) : rows;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeToolCall> }) => {
        const row = s().toolCalls.get(where.id);
        if (!row) throw new Error('fake toolCall not found');
        Object.assign(row, data);
        return row;
      },
    },
    artifact: {
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
        const rows = [...s().artifacts.values()].filter((row) =>
          matches(row as unknown as Record<string, unknown>, where)
        );
        return orderBy ? sortedByCreatedAtAsc(rows) : rows;
      },
      /** (MP4-F) রানারের metrics-finalization db.artifact.count কোয়েরি */
      count: async ({ where }: { where?: Record<string, unknown> }) => {
        let n = 0;
        for (const row of s().artifacts.values()) {
          if (where && !matches(row as unknown as Record<string, unknown>, where)) continue;
          n++;
        }
        return n;
      },
      /** Phase-4: createProduction-এর অটো-ওয়্যার কোয়েরি (সর্বশেষ আপলোড) */
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { createdAt?: 'asc' | 'desc' };
      }) => {
        const rows = [...s().artifacts.values()].filter((row) =>
          matches(row as unknown as Record<string, unknown>, where)
        );
        const dir = orderBy?.createdAt === 'asc' ? 1 : -1;
        rows.sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * dir);
        return rows[0] ?? null;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        s().artifacts.get(where.id) ?? null,
      create: async ({ data }: { data: Partial<FakeArtifact> }) => {
        const id = nextId('art');
        const row: FakeArtifact = {
          id,
          conversationId: data.conversationId ?? '',
          runId: data.runId ?? null,
          productionId: data.productionId ?? null,
          messageId: data.messageId ?? null,
          origin: data.origin ?? 'tool',
          kind: data.kind ?? 'text',
          mimeType: data.mimeType ?? 'application/octet-stream',
          fileName: data.fileName ?? '',
          size: data.size ?? 0,
          storagePath: data.storagePath ?? null,
          sourceUrl: data.sourceUrl ?? null,
          metaJson: data.metaJson ?? null,
          createdAt: new Date(),
        };
        s().artifacts.set(id, row);
        return row;
      },
    },
    async $transaction(ops: Array<Promise<unknown>>): Promise<unknown[]> {
      return Promise.all(ops);
    },
    // ---- Phase-4: production মডেল (confirm/cancel/config-panel টেস্ট) ----
    production: {
      create: async ({ data }: { data: Partial<FakeProduction> }) => {
        const id = nextId('prod');
        const row: FakeProduction = {
          id,
          conversationId: data.conversationId ?? '',
          type: data.type ?? 'image',
          title: data.title ?? 'প্রোডাকশন',
          status: data.status ?? 'awaiting_confirmation',
          specJson: data.specJson ?? '{}',
          progress: 0,
          currentStepKey: null,
          error: null,
          resultJson: null,
          parentProductionId: data.parentProductionId ?? null,
          createdAt: new Date(),
          confirmedAt: data.confirmedAt ?? null,
          startedAt: null,
          finishedAt: null,
        };
        s().productions.set(id, row);
        return row;
      },
      /** (MP4-F) include সমর্থন — SSE-রাউট/confirm-রাউটের steps+artifacts
       *  রিলেশন কোয়েরি; include না দিলে আগের মতোই খালি রো (t14-চুক্তি)। */
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { steps?: { orderBy?: { seq?: 'asc' | 'desc' } } | boolean; artifacts?: boolean };
      }) => {
        const row = s().productions.get(where.id);
        if (!row) return null;
        if (!include) return row;
        const withRels = { ...row } as FakeProduction & { steps?: FakeProductionStep[]; artifacts?: FakeArtifact[] };
        if (include.steps) {
          const steps = [...s().productionSteps.values()].filter(st => st.productionId === where.id);
          const desc = include.steps !== true && include.steps.orderBy?.seq === 'desc';
          steps.sort((a, b) => (desc ? b.seq - a.seq : a.seq - b.seq));
          withRels.steps = steps;
        }
        if (include.artifacts) {
          const arts = [...s().artifacts.values()]
            .filter(a => a.productionId === where.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          withRels.artifacts = arts;
        }
        return withRels;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = [...s().productions.values()].filter(row =>
          matches(row as unknown as Record<string, unknown>, where)
        );
        return rows;
      },
      count: async ({ where }: { where?: { createdAt?: { gte?: Date } } }) => {
        let n = 0;
        for (const row of s().productions.values()) {
          if (where?.createdAt?.gte && row.createdAt < where.createdAt.gte) continue;
          n++;
        }
        return n;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeProduction>;
      }) => {
        const row = s().productions.get(where.id);
        if (!row) throw new Error('fake production not found');
        Object.assign(row, data);
        // include: { steps, artifacts, _count } — রাউট-ভিউ সিরিয়ালাইজারের চুক্তি
        return { ...row, steps: [], artifacts: [], _count: { artifacts: 0 } };
      },
    },
    // ---- (MP4-F) productionStep মডেল — রানার-জীবনচক্র/মেট্রিকস টেস্ট ----
    productionStep: {
      create: async ({ data }: { data: Partial<FakeProductionStep> }) => {
        const id = nextId('pstep');
        const row: FakeProductionStep = {
          id,
          productionId: data.productionId ?? '',
          seq: data.seq ?? 0,
          key: data.key ?? '',
          title: data.title ?? '',
          status: data.status ?? 'pending',
          detail: null,
          error: null,
          startedAt: data.startedAt ?? null,
          finishedAt: null,
        };
        s().productionSteps.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeProductionStep>;
      }) => {
        const row = s().productionSteps.get(where.id);
        if (!row) throw new Error('fake productionStep not found');
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return [...s().productionSteps.values()].filter(row =>
          matches(row as unknown as Record<string, unknown>, where)
        );
      },
    },
  };
}

/** The Prisma-shaped object installed by mock.module('@/lib/db', ...). */
export const fakeDb = createFakeDb();
