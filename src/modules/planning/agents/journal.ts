import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { AgentReport } from "./contracts";

export const reviewSchema = z.object({
  archiveId: z.string().uuid(), proposalIndex: z.number().int().min(0).max(2),
  choice: z.enum(["accepted_guidance", "rejected", "simulation_requested"]),
  reason: z.string().trim().min(10).max(500),
});
export type Review = z.infer<typeof reviewSchema> & { createdAt: string };
export type JournalEntry = { id: string; report: AgentReport; reviews: Review[] };

// Local-server pilot: no cloud synchronization, no production authority.
export function createAgentJournal(root = process.env.AGENT_WORKSPACE_DIR || path.join(process.cwd(), "data/agent-workspace")) {
  const directory = (userId: string) => path.join(root, createHash("sha256").update(userId).digest("hex"));
  const validId = (id: string) => z.string().uuid().parse(id);
  async function archive(userId: string, report: AgentReport) {
    const id = randomUUID(); const dir = directory(userId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const saved = { ...report, archiveId: id };
    const temp = path.join(dir, `${id}.tmp`);
    await writeFile(temp, JSON.stringify(saved), { flag: "wx", mode: 0o600 });
    await rename(temp, path.join(dir, `${id}.json`));
    return saved;
  }
  async function list(userId: string): Promise<JournalEntry[]> {
    const dir = directory(userId);
    let files: string[];
    try { files = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const entries = await Promise.all(files.filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(async file => {
      const id = file.slice(0, -5);
      const report = JSON.parse(await readFile(path.join(dir, file), "utf8")) as AgentReport;
      const reviews: Review[] = [];
      for (let i = 0; i < report.findings.proposals.length; i++) {
        try { reviews.push(JSON.parse(await readFile(path.join(dir, `${id}-${i}.review`), "utf8"))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      return { id, report, reviews };
    }));
    return entries.sort((a,b) => b.report.createdAt.localeCompare(a.report.createdAt)).slice(0, 50);
  }
  async function review(userId: string, raw: unknown) {
    const input = reviewSchema.parse(raw); const dir = directory(userId);
    const report = JSON.parse(await readFile(path.join(dir, `${validId(input.archiveId)}.json`), "utf8")) as AgentReport;
    const proposal = report.findings.proposals[input.proposalIndex];
    if (!proposal) throw new Error("Proposta não encontrada.");
    if (input.choice === "simulation_requested" && !proposal.move) throw new Error("Esta proposta não contém uma troca calculada.");
    if (input.choice === "accepted_guidance" && proposal.move) throw new Error("Recalcule a troca antes de solicitar sua aplicação.");
    const result = { ...input, createdAt: new Date().toISOString() };
    // Exclusive creation prevents duplicate/conflicting decisions, including across processes.
    await writeFile(path.join(dir, `${input.archiveId}-${input.proposalIndex}.review`), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    return result;
  }
  return { archive, list, review };
}
