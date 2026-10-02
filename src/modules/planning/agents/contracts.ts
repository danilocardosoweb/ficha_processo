import { z } from "zod";
import { profileSchema } from "../decision-system/schema";
import { PLANNING_SPEC_VERSION } from "../source-of-truth";

export const agentRoles = ["pcp", "montador", "operador", "qualidade", "lider"] as const;
export type AgentRole = typeof agentRoles[number];
export const agentNames: Record<AgentRole,string> = {pcp:"PCP",lider:"Líder de produção",montador:"Montador",operador:"Operador da prensa",qualidade:"Apontamento / Qualidade"};
export const agentOperationalRole: Record<AgentRole,"planning"|"preparation"|"production"|"monitoring"|"replanning"> = {pcp:"planning",montador:"preparation",operador:"production",qualidade:"monitoring",lider:"replanning"};
const text = z.string().max(120);
const num = z.number().finite().min(0).max(100_000_000);
const instant = z.string().datetime({offset:true}).transform(value=>new Date(value));
const settingsSchema = z.object({billetBarWeightKg:num.positive(),extrusionEfficiency:z.number().min(0.01).max(1),defaultProductivityKgH:num.positive(),setupMinutes:num.max(1440),alloyChangeMinutes:num.max(1440),toolChangeMinutes:num.max(1440).optional(),toolHeatingMinutes:num.max(10080),ovenCount:num.max(100),ovenSlotsPerOven:num.max(100),ovenSlots:num.min(1).max(1000)});
export const agentContextSchema = z.object({
  orders:z.array(z.object({id:text.min(1),orderNumber:text,planCode:text,machineCode:text.min(1),toolCode:text,alloyCode:text,alternativeAlloys:z.array(text).max(20),targetKg:num,producedKg:num,sequence:num.int(),dueDate:z.string().max(60).nullable(),status:text,productivityKgH:num,productivitySource:z.enum(["simplificada","aprendizado","ficha","ferramenta","padrao"]),toolReadyAt:instant.nullable(),toolHeatingState:z.enum(["released","heating","waiting"]),holes:num.nullable().optional(),boCode:text.nullable().optional(),packageMeasureMm:num.nullable().optional(),carcassDiameterMm:num.nullable().optional(),carcassCode:text.nullable().optional(),carcassQuantity:num.optional()})).min(1).max(200),
  settings:z.record(z.string().max(40),settingsSchema).refine(value=>Object.keys(value).length<=10), start:instant,
  shifts:z.array(z.object({id:text,code:text,name:text,startTime:z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),endTime:z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),breakMinutes:num.max(1440),machineCodes:z.array(text).max(10),isActive:z.boolean()})).max(40),
  overtimePeriods:z.array(z.object({id:text,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startTime:z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),endTime:z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),machineCodes:z.array(text).max(10),reason:z.string().max(500),isActive:z.boolean()})).max(200).default([]),
  unavailable:z.array(z.object({id:text,resourceType:z.enum(["press","oven","tool","carcass","bo"]),resourceCode:text,startsAt:instant,endsAt:instant,reason:z.string().max(500),status:z.enum(["active","cancelled"])})).max(500),
  resources:z.object({carcasses:z.array(z.object({code:text,capacity:num,totalQuantity:num.optional(),unavailableQuantity:num.optional(),reservations:z.array(z.object({id:text,quantity:num,startsAt:instant.nullable(),endsAt:instant.nullable(),productionOrderId:text.nullable().optional()})).max(500)})).max(500),bos:z.array(z.object({code:text,capacity:num})).max(500)}),
  stock:z.array(z.object({alloyCode:text,availableBars:num,availableWeightKg:num})).max(100),stockKnown:z.boolean(),
}).superRefine((value,ctx)=>{
  if(new Set(value.orders.map(o=>o.id)).size!==value.orders.length) ctx.addIssue({code:"custom",message:"Ordens duplicadas."});
  if(value.orders.some(o=>!Object.hasOwn(value.settings,o.machineCode))) ctx.addIssue({code:"custom",message:"Faltam parâmetros de uma prensa."});
});
export const moveSchema = z.object({orderId:text.min(1),position:z.number().int().min(1).max(200),reason:z.string().min(10).max(400)});
export const proposalSchema = z.object({title:z.string().min(3).max(140),explanation:z.string().min(10).max(700),steps:z.array(z.string().min(3).max(280)).min(1).max(5),orderIds:z.array(text).max(20),evidence:z.array(z.enum(["programacao","recursos","fornos","materiais","equipe","operacao","simular_troca"])).min(1).max(6),move:moveSchema.nullable()});
export const findingsSchema = z.object({summary:z.string().min(10).max(1200),limitations:z.array(z.string().max(300)).max(8),handoff:z.string().max(700),proposals:z.array(proposalSchema).max(3)});
export type AgentFindings = z.infer<typeof findingsSchema>;
export type AgentReport = {role:AgentRole;operationalRole:"planning"|"preparation"|"production"|"monitoring"|"replanning";contextContract:{schemaVersion:1;specVersion:string;dataScope:"minimum-by-tool"};model:string;skillVersion:string;findings:AgentFindings;toolsUsed:string[];durationMs:number;createdAt:string;archiveId?:string;operationalRead?:{queriedAt:string;status:string;productionCount:number;cycleCount:number;limitations:string[]}};
export const agentContextContract = { schemaVersion: 1 as const, specVersion: PLANNING_SPEC_VERSION, dataScope: "minimum-by-tool" as const };
export const agentRequestSchema = z.object({provider:z.enum(["openrouter","lmstudio","openai","openclaw"]).default("openrouter"),localModel:z.string().trim().max(200).optional(),cloudModel:z.string().trim().max(200).optional(),role:z.enum(agentRoles),context:agentContextSchema,profile:profileSchema,peers:z.array(z.object({role:z.enum(agentRoles),findings:findingsSchema})).max(4),instruction:z.string().max(1000).default("")});
export type AgentInput = z.infer<typeof agentRequestSchema>;
export type AgentEvent = {type:"activity";message:string;step?:number;maxSteps?:number} | {type:"complete";report:AgentReport} | {type:"error";message:string};
