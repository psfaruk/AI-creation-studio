-- ============================================================
-- SQLite bootstrap-DDL (P4-hotfix) — স্বয়ংক্রিয়-জেনারেটেড, হাতে সম্পাদনা নয়।
--
-- উৎস: bunx prisma migrate diff --from-empty \
--         --to-schema-datamodel prisma/schema.prisma --script
--
-- ভূমিকা: প্রোডাকশন বুট-স্ব-নিরাময় (src/lib/db-schema-heal.ts) ফ্রেশ
-- ভলিউম-ডেটাবেসে এই DDL-টুকু সরাসরি query-engine দিয়ে চালায়
-- (prisma CLI-র রানটাইম-নির্ভরতা [effect-ক্লোজার, ~৩২ প্যাকেজ] ইমেজে
-- না টেনেই)। স্টেটমেন্ট-বিভাজক: ";\n" — স্ট্রিং-অভ্যন্তরে সেমিকোলন নেই
-- (জেনারেটর-নিশ্চয়তা)।
--
-- সতর্কতা: prisma/schema.prisma বদালে এই ফাইল পুনঃজেনারেট করুন —
--   bunx prisma migrate diff --from-empty \
--     --to-schema-datamodel prisma/schema.prisma --script \
--     > prisma/sqlite-bootstrap.sql
-- (Docker বিল্ডার প্রতি বিল্ডে নিজেই পুনঃজেনারেট করে — ইমেজে কখনো
-- stale হয় না; এই চেকইন মূলত dev/স্বচ্ছতার জন্য।)
-- ============================================================

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'নতুন কথোপকথন',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "runId" TEXT,
    "productionId" TEXT,
    "attachmentsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "errorCategory" TEXT,
    "endReason" TEXT,
    "cacheStatus" TEXT,
    "requestedMode" TEXT,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "firstTokenMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "model" TEXT,
    "usedModel" TEXT,
    CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "argsJson" TEXT NOT NULL,
    "inputSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outputSummary" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "productionId" TEXT,
    "messageId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'tool',
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "sourceUrl" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
    "specJson" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStepKey" TEXT,
    "error" TEXT,
    "resultJson" TEXT,
    "parentProductionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Production_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Production_parentProductionId_fkey" FOREIGN KEY ("parentProductionId") REFERENCES "Production" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "ProductionStep_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'প্রধান চরিত্র',
    "description" TEXT NOT NULL,
    "appearanceJson" TEXT,
    "language" TEXT NOT NULL DEFAULT 'bn',
    "voice" TEXT NOT NULL DEFAULT 'jam',
    "portraitArtifactId" TEXT,
    "continuityNotesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "licenseUrl" TEXT,
    "commercialUse" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "licenseStatus" TEXT,
    "providerStatus" TEXT,
    "integrationStatus" TEXT,
    "runtimeStatus" TEXT,
    "qualityStatus" TEXT,
    "apiEndpoint" TEXT,
    "apiModelId" TEXT,
    "lastTestedAt" DATETIME,
    "lastTestNote" TEXT,
    "errorReason" TEXT,
    "toolsJson" TEXT,
    "capabilitiesJson" TEXT NOT NULL,
    "hardwareNotes" TEXT,
    "notes" TEXT,
    "verifiedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_runId_key" ON "Message"("runId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE INDEX "AgentStep_runId_seq_idx" ON "AgentStep"("runId", "seq");

-- CreateIndex
CREATE INDEX "ToolCall_runId_createdAt_idx" ON "ToolCall"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_conversationId_createdAt_idx" ON "Artifact"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_runId_idx" ON "Artifact"("runId");

-- CreateIndex
CREATE INDEX "Artifact_productionId_idx" ON "Artifact"("productionId");

-- CreateIndex
CREATE INDEX "Production_conversationId_createdAt_idx" ON "Production"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Production_status_idx" ON "Production"("status");

-- CreateIndex
CREATE INDEX "ProductionStep_productionId_seq_idx" ON "ProductionStep"("productionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Character_conversationId_name_key" ON "Character"("conversationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ModelEntry_key_key" ON "ModelEntry"("key");

