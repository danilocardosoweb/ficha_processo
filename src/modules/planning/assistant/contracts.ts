import { z } from "zod";

export const assistantContextSchema = z.object({
  route: z.string().max(160).optional(),
  screen: z.string().max(120).optional(),
  machineCode: z.string().max(40).optional(),
  toolCode: z.string().max(80).optional(),
  orderId: z.string().max(120).optional(),
  date: z.string().max(40).optional(),
  scenario: z.enum(["current", "simulation", "history"]).optional(),
}).strict();

export type AssistantContext = z.infer<typeof assistantContextSchema>;

export const assistantRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(40),
  context: assistantContextSchema.optional(),
  // Envelope fields added by AI SDK's DefaultChatTransport. They are not
  // forwarded to the model and are validated only to keep the request bounded.
  id: z.string().max(200).optional(),
  trigger: z.string().max(40).optional(),
  messageId: z.string().max(200).optional(),
}).strict();

export type AssistantQueryStatus = "available" | "partial" | "unavailable";

export type AssistantSource = {
  id: string;
  label: string;
  kind: "record" | "calculation" | "configuration" | "pending-data";
};

export type AssistantQueryResult = {
  status: AssistantQueryStatus;
  asOf: string;
  source: string;
  summary: string;
  rows: Record<string, unknown>[];
  limitations: string[];
  evidenceRefs?: AssistantSource[];
};

export function queryResult(
  input: Omit<AssistantQueryResult, "asOf"> & { asOf?: string },
): AssistantQueryResult {
  return {
    ...input,
    asOf: input.asOf ?? new Date().toISOString(),
  };
}
