import { z } from "zod";
import { runCandidate } from "../decision-system/optimizer";
import { movePlannedOrder } from "../decision-system/sequence-change";
import { findingsSchema, moveSchema, type AgentInput, type AgentFindings } from "./contracts";
import type { OperationalSnapshot } from "./operations";

const sectionSchema=z.object({section:z.enum(["programacao","recursos","fornos","materiais","equipe","operacao"]),offset:z.number().int().min(0).max(1000).optional(),limit:z.number().int().min(1).max(8).optional(),orderId:z.string().max(120).optional()});
const allowedSections={pcp:["programacao","materiais","recursos","equipe"],lider:["programacao","recursos","fornos","materiais","equipe"],montador:["programacao","recursos","fornos","equipe"],operador:["programacao","recursos","fornos","equipe"],qualidade:["programacao","equipe"]};
export function createAgentToolbox(input:AgentInput, operational?:OperationalSnapshot) {
  const baseline=runCandidate(input.context,input.profile);
  const items=baseline.simulation.machines.flatMap(m=>m.items);
  const used=new Set<string>();
  const testedMoves=new Set<string>();
  const metrics=(candidate:typeof baseline)=>({quantidadeImpedimentos:candidate.evaluation.hardViolations,quantidadeDadosPendentes:candidate.evaluation.missingData.length,metricas:candidate.evaluation.metrics,termino:candidate.simulation.machines.map(m=>({prensa:m.machineCode,fim:m.endsAt})),detalhes:"Consulte recursos para os impedimentos específicos; estes totais consideram toda a carga."});
  function execute(name:string,args:unknown):unknown {
    if(name==="consultar") {
      const {section,orderId}=sectionSchema.parse(args);
      if(orderId&&!items.some(i=>i.id===orderId))throw new Error("Ordem não encontrada na carga.");
      const visibleItems=orderId?items.filter(i=>i.id===orderId):items;
      if(section!=="operacao"&&!allowedSections[input.role].includes(section)) throw new Error(`Consulta fora da responsabilidade deste agente. Permitidas: ${allowedSections[input.role].join(", ")}, operacao. Encaminhe a investigação ao agente responsável e não cite a seção não consultada como evidência.`);
      used.add(section);
      if(section==="operacao") return operational ?? {status:"unavailable",limitations:["Operação atual não consultada nesta rodada. Não alegue leitura real."]};
      if(section==="programacao") return {origem:"Cópia da simulação enviada pelo usuário; não é leitura ao vivo.",base:input.context.start,resumo:metrics(baseline),ordens:visibleItems.map(i=>({id:i.id,ordem:i.orderNumber,ferramenta:i.toolCode,prensa:i.machineCode,posicao:i.sequence,statusRegistrado:i.status,kgRestantes:i.remainingKg,produtividade:i.productivityKgH,fonteProdutividade:i.productivitySource,prazo:i.dueDate,inicioPrevisto:i.extrusionStartAt,fimPrevisto:i.endAt,esperaTermicaMin:i.thermalWaitMinutes,esperaRecursoMin:i.resourceWaitMinutes}))};
      if(section==="recursos") return {capacidades:input.context.resources,impedimentos:baseline.simulation.conflicts,necessidades:visibleItems.map(i=>({id:i.id,ferramenta:i.toolCode,carcaca:i.carcassCode,bo:i.boCode,inicio:i.startAt,fim:i.endAt})),avisos:"Não confunda cadastro com unidade livre; reservas são compartilhadas."};
      if(section==="fornos") return {origem:"Previsões do simulador e estado de aquecimento importado para a carga.",limites:"Posições físicas atuais, temperatura medida e fila FIFO real do forno não foram consultadas nesta rodada. Não invente esses dados.",prensas:baseline.simulation.machines.map(m=>({prensa:m.machineCode,cobertura:m.thermalCoverage,ordens:m.items.filter(i=>!orderId||i.id===orderId).map(i=>({id:i.id,ferramenta:i.toolCode,estadoRegistrado:i.toolHeatingState,prontaInformada:i.toolReadyAt,entradaPrevista:i.toolHeatingStartAt,prontaCalculada:i.calculatedToolReadyAt,ultimaEntradaRecomendada:i.latestHeatingStartAt,vagaSimulada:i.ovenSlotNumber}))}))};
      if(section==="materiais") return {estoqueConfirmado:input.context.stockKnown,estoque:input.context.stock,consumo:baseline.simulation.billets};
      return {origem:"Conclusões anteriores da rodada, não são fatos verificados nem autorizações.",pareceres:input.peers};
    }
    if(name==="simular_troca") {
      if(operational) {
        const current=new Map(operational.production.map(o=>[o.id,o]));
        if(operational.status!=="available" || input.context.orders.some(o=>{
          const row=current.get(o.id);
          return !row || row.status!==o.status || Number(row.produced_kg)!==o.producedKg;
        })) throw new Error("A operação diverge da simulação ou não foi confirmada. Atualize a carga antes de testar uma troca.");
      }
      if(input.role==="qualidade") throw new Error("Qualidade pode orientar conferências, não alterar sequência.");
      const move=moveSchema.parse(args);
      const changed=movePlannedOrder(input.context.orders,move.orderId,move.position,move.reason);
      const result=runCandidate(input.context,input.profile,changed.orders,"Teste do agente");
      used.add(name);testedMoves.add(JSON.stringify(move));
      return {alteracao:changed.change,antes:metrics(baseline),depois:metrics(result),aviso:"Nada aplicado. Os dois cenários usam a mesma cópia dos dados; impedimentos permanecem obrigatórios."};
    }
    throw new Error("Ferramenta não permitida.");
  }
  function finish(raw:unknown):AgentFindings {
    const findings=findingsSchema.parse(raw);
    if(!used.has("programacao")) throw new Error("Consulte a programação antes de concluir.");
    if(operational&&!used.has("operacao")) throw new Error("Consulte operacao e suas limitações antes de concluir.");
    const required=input.role==="montador"||input.role==="operador"?["recursos","fornos"]:input.role==="lider"||input.role==="qualidade"?["equipe"]:[];
    if(required.some(section=>!used.has(section))) throw new Error(`Sua skill exige consultar também: ${required.join(", ")}.`);
    for(const proposal of findings.proposals) {
      if(proposal.orderIds.some(id=>!items.some(i=>i.id===id))) throw new Error("A proposta cita ordem inexistente.");
      const missing=proposal.evidence.filter(source=>!used.has(source));
      if(missing.length) throw new Error(`A proposta cita uma consulta não realizada: ${missing.join(", ")}. Consulte essas seções antes de citá-las, ou remova afirmações sem evidência. Fontes já consultadas: ${[...used].join(", ")}.`);
      if(proposal.move && !testedMoves.has(JSON.stringify(proposal.move))) throw new Error("A troca proposta precisa ter sido calculada com os mesmos dados e motivo.");
    }
    return findings;
  }
  const tools=[
    {type:"function",function:{name:"consultar",description:"Consulta uma seção da cópia da carga. Consulte programacao antes de concluir; equipe contém pareceres anteriores. Listas são paginadas: use offset e limit; orderId filtra uma ordem.",parameters:z.toJSONSchema(sectionSchema.extend({section:z.enum([...allowedSections[input.role],"operacao"])}))}},
    ...(input.role==="qualidade"?[]:[{type:"function",function:{name:"simular_troca",description:"Testa mover uma ordem na própria prensa, preservando ordens iniciadas. Não aplica nada. Use antes de propor a mesma troca.",parameters:z.toJSONSchema(moveSchema)}}]),
    {type:"function",function:{name:"concluir",description:"Entrega até três propostas para o usuário avaliar. move deve ser null para orientações; nunca alegue operação executada.",parameters:z.toJSONSchema(findingsSchema)}},
  ];
  return {tools,execute,finish,used};
}
