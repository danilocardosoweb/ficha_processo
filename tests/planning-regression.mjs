import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
const requireExternal = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, "..", relative);
  if (cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} };
  cache.set(file, loadedModule);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const resolve = name => name.startsWith("@/")
    ? load("src/" + name.slice(2) + ".ts")
    : name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts"))
    : requireExternal(name);
  new Function("require", "module", "exports", js)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const productivity = load("src/modules/planning/productivity.ts");
const {buildProgram}=load("src/modules/machine-load-v2/domain.ts");
const {generateRulePreview}=load("src/modules/machine-load-v2/domain.ts");
const {moveScenarioRow}=load("src/modules/machine-load-v2/domain.ts");
const {evaluateTemporalResources}=load("src/modules/machine-load-v2/evaluator.ts");
const programOrder={id:"o1",order_number:"OP1",machine_code:"18",tool_code:"TCG-012",sequence:2,alloy_code:"6063",target_kg:300,produced_kg:0,status:"planned",carcass_code:null,bo_code:null,last_productivity_kg_h:null,actual_start:null,source_data:{sequencia:"008"}};
const programTool={code:"TCG-012",matrix_code:"TCG-012",sequence_number:8,source_available:true,carcass_code:"250X170",bo:"3",productivity_kg_h:1400};
test("nova programação: preserva posição oficial e não altera os registros de entrada",()=>{
  const input=[{...programOrder,id:"b",sequence:9},{...programOrder,id:"a",sequence:2}];
  const before=JSON.stringify(input);
  assert.deepEqual(buildProgram(input,[programTool]).map(row=>row.position),[2,9]);
  assert.equal(JSON.stringify(input),before);
});
test("nova programação: volume desconhecido não vira zero e produtividade inválida usa padrão",()=>{
  const [row]=buildProgram([{...programOrder,target_kg:null,last_productivity_kg_h:90000}],[]);
  assert.equal(row.remainingKg,null);assert.equal(row.productiveMinutes,null);
  assert.equal(row.productivity,1300);assert.equal(row.productivitySource,"Padrão estimado");
  assert.ok(row.issues.includes("Volume restante a confirmar"));
});
test("nova programação: usa sequência física exata e mantém divergência visível",()=>{
  const [row]=buildProgram([{...programOrder,carcass_code:"228X130"}],[programTool]);
  assert.equal(row.physicalSequence,8);assert.equal(row.bo,"3");
  assert.equal(row.carcass,"228X130");assert.equal(row.carcassSource,"Ordem");
  assert.ok(row.issues.some(issue=>issue.includes("diverge")));
  const [missing]=buildProgram([{...programOrder,source_data:{sequencia:"009"}}],[programTool]);
  assert.equal(missing.carcass,null);
});
test("nova programação: volume produzido é abatido e duração não é previsão de saída",()=>{
  const [row]=buildProgram([{...programOrder,target_kg:650,produced_kg:325,last_productivity_kg_h:1300}],[]);
  assert.equal(row.remainingKg,325);assert.equal(row.productiveMinutes,15);
  assert.equal("endAt" in row,false);
});
test("cenário por regras: é separado, estável e não move ordem iniciada",()=>{
  const rows=buildProgram([
    {...programOrder,id:"a",sequence:1,alloy_code:"6082"},
    {...programOrder,id:"b",sequence:2,alloy_code:"6063"},
    {...programOrder,id:"c",sequence:3,alloy_code:"6063",actual_start:"2026-09-16T10:00:00Z"},
  ],[programTool]);
  const preview=generateRulePreview(rows);
  assert.equal(preview.rows.length,3);
  assert.equal(preview.rows.find(row=>row.id==="c").position,3);
  assert.equal(preview.rows.find(row=>row.id==="b").position,1);
  assert.ok(preview.changes.length>0);
  assert.ok(preview.blockedReasons.some(reason=>reason.includes("Tipo")));
  assert.equal(rows.find(row=>row.id==="c").position,3);
});
test("cenário: ajuste manual exige motivo e preserva ordem iniciada",()=>{
  const rows=buildProgram([
    {...programOrder,id:"manual-a",sequence:1,alloy_code:"6063"},
    {...programOrder,id:"manual-b",sequence:2,alloy_code:"6082"},
    {...programOrder,id:"manual-c",sequence:3,alloy_code:"6063",actual_start:"2026-09-16T10:00:00Z"},
  ],[programTool]);
  const scenario=generateRulePreview(rows);
  assert.equal(moveScenarioRow(scenario,"manual-b",-1,"").rows.find(row=>row.id==="manual-b").position,scenario.rows.find(row=>row.id==="manual-b").position);
  const moved=moveScenarioRow(scenario,"manual-b",-1,"Carcaça liberada pelo montador");
  assert.equal(moved.rows.find(row=>row.id==="manual-b").position,1);
  assert.ok(moved.changes.find(change=>change.id==="manual-b").reason.includes("Carcaça"));
  assert.equal(moveScenarioRow(moved,"manual-c",-1,"tentativa").rows.find(row=>row.id==="manual-c").position,moved.rows.find(row=>row.id==="manual-c").position);
});
test("avaliador temporal: desconhecido não vira disponibilidade",()=>{
  const rows=buildProgram([{...programOrder,id:"unknown",target_kg:300,produced_kg:0}], [programTool]);
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T08:00:00Z"),{carcaças:[],bos:[],fornos:[]},{setupMinutes:10,heatingMinutes:60});
  assert.equal(result.status,"incomplete");assert.equal(result.conflicts,0);assert.equal(result.unknowns,1);
  assert.ok(result.rows[0].issues.some(issue=>issue.includes("não confirmada")));
});
test("avaliador temporal: capacidade e reserva sobreposta geram conflito explicável",()=>{
  const rows=buildProgram([
    {...programOrder,id:"a",sequence:1,target_kg:1300,produced_kg:0,carcass_code:"250X170",bo_code:"3"},
    {...programOrder,id:"b",sequence:2,target_kg:1300,produced_kg:0,carcass_code:"250X170",bo_code:"3"},
  ], [{...programTool,carcass_code:"250X170",bo:"3",productivity_kg_h:1300}]);
  const resources={carcaças:[{code:"250X170",capacity:1,reservations:[{resource:"250X170",startsAt:"2026-09-16T08:00:00Z",endsAt:"2026-09-16T09:00:00Z"}]}],bos:[{code:"3",capacity:1}],fornos:[]};
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T08:00:00Z"),resources,{setupMinutes:0,heatingMinutes:0,ovenCapacityPerPress:2});
  assert.equal(result.status,"blocked");assert.equal(result.conflicts,1);
  assert.ok(result.rows[0].issues.some(issue=>issue.includes("sem unidade livre")));
});
test("avaliador temporal: duas prensas podem usar o mesmo recurso em intervalos distintos",()=>{
  const rows=buildProgram([
    {...programOrder,id:"a",machine_code:"18",sequence:1,target_kg:300,produced_kg:0,carcass_code:"250X170",bo_code:"3"},
    {...programOrder,id:"b",machine_code:"19",tool_code:"TCG-013",sequence:1,target_kg:300,produced_kg:0,carcass_code:"250X170",bo_code:"3"},
  ], [{...programTool,carcass_code:"250X170",bo:"3",productivity_kg_h:1300},{...programTool,code:"TCG-013",matrix_code:"TCG-013",carcass_code:"250X170",bo:"3"}]);
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T08:00:00Z"),{carcaças:[{code:"250X170",capacity:2}],bos:[{code:"3",capacity:2}],fornos:[]},{ovenCapacityPerPress:2});
  assert.notEqual(result.status,"blocked");assert.equal(result.rows.length,2);
});
test("avaliador temporal: posições do forno ocupadas entram no intervalo físico",()=>{
  const rows=buildProgram([{...programOrder,id:"oven",target_kg:300,produced_kg:0,carcass_code:"250X170",bo_code:"3"}],[{...programTool,carcass_code:"250X170",bo:"3",productivity_kg_h:1300}]);
  const resources={carcaças:[{code:"250X170",capacity:1}],bos:[{code:"3",capacity:1}],fornos:[{code:"18:FORNO",capacity:1,reservations:[{resource:"18:FORNO",startsAt:"2026-09-16T08:00:00Z",endsAt:"2026-09-16T09:00:00Z"}]}]};
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T08:00:00Z"),resources,{heatingMinutes:30});
  assert.equal(result.status,"blocked");assert.ok(result.rows[0].issues.some(issue=>issue.includes("posição de forno")));
});
test("avaliador temporal: parada cadastrada desloca a ordem e registra espera",()=>{
  const rows=buildProgram([{...programOrder,id:"pause",target_kg:300,produced_kg:0,carcass_code:"250X170",bo_code:"3"}],[{...programTool,carcass_code:"250X170",bo:"3",productivity_kg_h:1300}]);
  const resources={carcaças:[{code:"250X170",capacity:1}],bos:[{code:"3",capacity:1}],fornos:[],calendarBlocks:[{resource:"18",startsAt:"2026-09-16T08:00:00Z",endsAt:"2026-09-16T09:00:00Z"}]};
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T08:00:00Z"),resources);
  assert.equal(result.rows[0].startAt,"2026-09-16T09:00:00.000Z");assert.equal(result.calendarWaitMinutes,60);
});
test("avaliador temporal: almoço é preferência contabilizada, não bloqueio",()=>{
  const rows=buildProgram([{...programOrder,id:"lunch",target_kg:1300,produced_kg:0,carcass_code:"250X170",bo_code:"3"}],[{...programTool,carcass_code:"250X170",bo:"3",productivity_kg_h:1300}]);
  const resources={carcaças:[{code:"250X170",capacity:1}],bos:[{code:"3",capacity:1}],fornos:[]};
  const result=evaluateTemporalResources(rows,new Date("2026-09-16T13:00:00Z"),resources);
  assert.equal(result.status,"incomplete");assert.equal(result.lunchInterventions,1);assert.equal(result.rows[0].lunchIntervention,true);
});
const {sameRequestOrigin}=load("src/modules/planning/agents/request-origin.ts");
test("origem: aceita autoridade local real e bloqueia sites externos e origem ausente",()=>{
  const check=origin=>sameRequestOrigin(new Request("http://localhost:3000/api/test",{headers:{host:"127.0.0.1:3000",...(origin?{origin}:{})}}));
  assert.equal(check("http://127.0.0.1:3000"),true);
  for(const value of [undefined,"null","https://evil.example","http://127.0.0.1:3001","http://127.0.0.1:3000/path"])assert.equal(check(value),false);
});
const {freeToolModels,fetchFreeModels,probeProvider}=load("src/modules/planning/agents/catalog.ts");
const {compactEvidence,evidenceMessage}=load("src/modules/planning/agents/compact-evidence.ts");
test("catálogo: somente modelos gratuitos com ferramentas",()=>{
  const base={id:"free",supported_parameters:["tools","tool_choice"],pricing:{prompt:"0",completion:"0"}};
  assert.deepEqual(freeToolModels({data:[base,{...base,id:"paid",pricing:{prompt:"0.1",completion:"0"}},{...base,id:"unknown",pricing:{}},{...base,id:"plain",supported_parameters:[]}]}).map(m=>m.id),["free"]);
});
test("evidências: paginação explícita e resposta limitada",()=>{
  const rows=Array.from({length:65},(_,id)=>({id,text:"x".repeat(500)}));
  const page=compactEvidence(rows,4,2);
  assert.equal(page.total,65);assert.equal(page.partial,true);assert.equal(page.nextOffset,6);
  assert.deepEqual(page.items.map(r=>r.id),[4,5]);
  assert.ok(evidenceMessage({rows},0,8).length<6500);
  assert.match(evidenceMessage({rows}),/não representa a carga inteira/);
});
test("OpenRouter: teste real de ferramentas sem dados de produção",{skip:!process.env.ALUPILOT_FREE_PROBE},async()=>{
  const models=await fetchFreeModels(AbortSignal.timeout(15000));
  const model=models.find(m=>m.id===process.env.ALUPILOT_FREE_PROBE);
  assert.ok(model,"Modelo deve estar no catálogo gratuito atual");
  const config=resolveAgentProvider("openrouter",undefined,{aiModelMode:"manual",aiModel:model.id},process.env);
  const result=await probeProvider(config,AbortSignal.timeout(60000));
  assert.ok(result.model);console.log("Teste real aprovado:",result.model,result.durationMs,"ms");
});
const {agentRequestSchema}=load("src/modules/planning/agents/contracts.ts");
const {createAgentToolbox}=load("src/modules/planning/agents/toolbox.ts");
const {runAgent}=load("src/modules/planning/agents/runner.ts");
const {resolveAgentProvider,completionRequest,callAgentModel,localBaseUrl}=load("src/modules/planning/agents/provider.ts");
const {localProviderFailure}=load("src/modules/planning/agents/provider.ts");
const {canonicalLocalModel}=load("src/modules/planning/agents/provider.ts");
test("LM Studio: resolve nome abreviado sem carregar outra cópia e recusa ambiguidades",()=>{
  assert.equal(canonicalLocalModel("qwen3.8-27b",["qwen/qwen3.8-27b"]),"qwen/qwen3.8-27b");
  assert.equal(canonicalLocalModel("qwen/qwen3.8-27b",["qwen/qwen3.8-27b"]),"qwen/qwen3.8-27b");
  assert.throws(()=>canonicalLocalModel("modelo",["a/modelo","b/modelo"]),/única/);
  assert.throws(()=>canonicalLocalModel("ausente",["qwen/qwen3.8-27b"]),/não encontrado/);
});
test("LM Studio: mostra falta de memória e não expõe detalhes arbitrários",()=>{
  assert.match(localProviderFailure(400,{error:{message:'Failed to load model. Model loading was stopped due to insufficient system resources. This model requires approximately 19.54 GB of memory.'}}),/19,54 GB/);
  assert.match(localProviderFailure(400,{error:{message:'context length exceeded'}}),/Contexto insuficiente/);
  assert.match(localProviderFailure(404,{error:{message:'model not found'}}),/Modelo não encontrado/);
  assert.ok(!localProviderFailure(500,{error:{message:'private-secret-path'}}).includes("private-secret"));
});
const {createAgentJournal}=load("src/modules/planning/agents/journal.ts");
const {operationalScope,loadOperationalSnapshot}=load("src/modules/planning/agents/operations.ts");
test("operação: escopo por prensa, consultas parciais e sem dados pessoais",async()=>{
  assert.deepEqual(operationalScope({machine_codes:["18"]},["18","19","18"]),["18"]);
  const calls=[];
  const client={from(table){
    const query={then(resolve){return Promise.resolve(table==="tool_ovens"?{error:{message:"offline"},data:null}:{error:null,data:[]}).then(resolve);}};
    for(const name of ["select","eq","in","order","limit","abortSignal"])query[name]=(...args)=>{calls.push({table,name,args});return query;};
    return query;
  }};
  const result=await loadOperationalSnapshot(client,{organization_id:"org-autorizada",machine_codes:["18"]},agentFixture(),new AbortController().signal);
  assert.equal(result.status,"partial");
  assert.ok(result.limitations.some(l=>l.includes("ovens indisponível")));
  assert.equal(calls.filter(c=>c.name==="eq"&&c.args[0]==="organization_id"&&c.args[1]==="org-autorizada").length,3);
  assert.ok(calls.filter(c=>c.name==="select").every(c=>!c.args[0].includes("name")&&!c.args[0].includes("notes")));
});
test("operação: dado enviado pelo navegador não substitui leitura e divergência bloqueia troca",()=>{
  const input=agentFixture();
  const forged=agentRequestSchema.parse(JSON.parse(JSON.stringify({...input,operational:{status:"available"}})));
  assert.equal(forged.operational,undefined);
  const snapshot={status:"unavailable",queriedAt:new Date().toISOString(),production:[],ovens:[],cycles:[],limitations:["Consulta falhou"]};
  const box=createAgentToolbox(input,snapshot);
  box.execute("consultar",{section:"programacao"});
  assert.throws(()=>box.finish(agentFindings()),/operacao/);
  assert.equal(box.execute("consultar",{section:"operacao"}).status,"unavailable");
  assert.throws(()=>box.execute("simular_troca",{orderId:input.context.orders[0].id,position:2,reason:"Testar troca com dados atuais"}),/diverge/);
  const changed={...snapshot,status:"available",production:input.context.orders.map(o=>({id:o.id,status:"in_progress",produced_kg:o.producedKg}))};
  assert.throws(()=>createAgentToolbox(input,changed).execute("simular_troca",{orderId:input.context.orders[0].id,position:2,reason:"Testar troca com dados atuais"}),/diverge/);
});
test("workspace: histórico durável isolado e decisões exclusivas", async()=>{
  const root=fs.mkdtempSync(path.join(requireExternal("node:os").tmpdir(),"alupilot-journal-test-"));
  try {
    const journal=createAgentJournal(root);
    const report={role:"pcp",model:"teste",skillVersion:"1",toolsUsed:["programacao"],durationMs:5,createdAt:new Date().toISOString(),findings:{summary:"Conferir disponibilidade antes de agir.",limitations:[],handoff:"Conferir",proposals:[{title:"Conferir recursos",explanation:"Confirme os recursos antes de operar.",steps:["Conferir"],orderIds:[],evidence:["programacao"],move:null}]}};
    const saved=await journal.archive("usuario-a",report);
    assert.equal((await createAgentJournal(root).list("usuario-a")).length,1);
    assert.equal((await journal.list("usuario-b")).length,0);
    const input={archiveId:saved.archiveId,proposalIndex:0,choice:"accepted_guidance",reason:"Conferir estoque antes da preparação."};
    await assert.rejects(()=>journal.review("usuario-b",input));
    await assert.rejects(()=>journal.review("usuario-a",{...input,reason:"curto"}));
    await assert.rejects(()=>journal.review("usuario-a",{...input,choice:"simulation_requested"}));
    const outcomes=await Promise.allSettled([journal.review("usuario-a",input),journal.review("usuario-a",{...input,choice:"rejected"})]);
    assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    const history=await createAgentJournal(root).list("usuario-a");
    assert.equal(history[0].reviews.length,1);
    assert.equal(history[0].reviews[0].reason,input.reason);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("LM Studio: não exige chave OpenRouter e não envia parâmetros da nuvem",()=>{
  const local=resolveAgentProvider("lmstudio","modelo-local",{},{});
  assert.equal(local.baseUrl,"http://127.0.0.1:1234/v1");
  const request=completionRequest(local,[{role:"user",content:"teste"}],[]);
  assert.equal(request.headers.Authorization,undefined);
  assert.equal(request.body.provider,undefined);
  assert.equal(request.body.model,"modelo-local");
  assert.equal(request.url,"http://127.0.0.1:1234/v1/chat/completions");
  assert.throws(()=>resolveAgentProvider("lmstudio","",{},{}),/Selecione/);
  assert.throws(()=>localBaseUrl({LM_STUDIO_BASE_URL:"file:///segredo"}),/inválida/);
  assert.throws(()=>localBaseUrl({LM_STUDIO_BASE_URL:"http://usuario:senha@localhost:1234/v1"}),/inválida/);
  assert.equal(resolveAgentProvider("openrouter",undefined,{aiModelMode:"manual",aiModel:"escolhido"},{OPENROUTER_API_KEY:"ficticia"}).model,"escolhido");
});
test("LM Studio: falha local não faz fallback para nuvem",async()=>{
  const original=globalThis.fetch;const urls=[];
  try {
    globalThis.fetch=async(url)=>{urls.push(url);throw new TypeError("offline");};
    await assert.rejects(()=>callAgentModel(resolveAgentProvider("lmstudio","local",{},{OPENROUTER_API_KEY:"nao-usar"}),[],[],new AbortController().signal),/conectar ao LM Studio/);
    assert.deepEqual(urls,["http://127.0.0.1:1234/v1/chat/completions"]);
  }finally{globalThis.fetch=original;}
});
function agentFixture(role="pcp") {
  const context=fixture();context.stock=[{alloyCode:"6060",availableBars:100,availableWeightKg:41500}];
  return agentRequestSchema.parse(JSON.parse(JSON.stringify({role,context,profile:decisionPresets[0],peers:[],instruction:""})));
}
const agentFindings=()=>({summary:"Conferir as ordens antes de alterar a sequência.",limitations:[],handoff:"Conferir recursos com o responsável.",proposals:[]});
test("agentes: LM Studio real com carga fictícia",{skip:!process.env.ALUPILOT_LM_SMOKE_MODEL},async()=>{
  const input=agentFixture();input.instruction="Carga fictícia para teste. Consulte programação e material; conclua um parecer curto sem aplicar nada.";
  const config=resolveAgentProvider("lmstudio",process.env.ALUPILOT_LM_SMOKE_MODEL,{},process.env);
  const skill=fs.readFileSync(path.resolve(__dirname,"../src/modules/planning/agents/skills/pcp/SKILL.md"),"utf8");
  const report=await runAgent(input,skill,(messages,tools,signal)=>{
    const last=messages.at(-1);if(last?.role==="tool"){try{const issue=JSON.parse(last.content).dados?.erro;if(issue)console.log("Correção solicitada no teste fictício:",issue);}catch{}}
    return callAgentModel(config,messages,tools,signal);
  },AbortSignal.timeout(config.totalMs),event=>{if(event.type==="activity")console.log(event.message);});
  assert.ok(report.toolsUsed.includes("programacao"));assert.ok(report.findings.summary.length>10);
  console.log("LM Studio real concluiu:",report.model,"; fontes:",report.toolsUsed.join(", "));
});
test("agentes: provedor real com carga fictícia",{skip:process.env.ALUPILOT_AGENT_SMOKE!=="1"},async()=>{
  assert.ok(process.env.OPENROUTER_API_KEY,"Integração não configurada para o teste real.");
  const input=agentFixture();input.instruction="Teste com dados fictícios. Consulte programação e material e conclua de forma curta, sem propor alterações.";
  const skill=fs.readFileSync(path.resolve(__dirname,"../src/modules/planning/agents/skills/pcp/SKILL.md"),"utf8");
  const report=await runAgent(input,skill,async(messages,tools,signal)=>{
    const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",signal,headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"openrouter/auto",messages,tools,tool_choice:"required",max_tokens:1600,temperature:0.2,provider:{require_parameters:true,allow_fallbacks:true,data_collection:"deny"}})});
    assert.ok(response.ok,`Provedor retornou HTTP ${response.status}`);
    return await response.json();
  },AbortSignal.timeout(90000),()=>{});
  assert.equal(report.role,"pcp");assert.ok(report.toolsUsed.includes("programacao"));assert.ok(report.findings.summary.length>10);
  console.log("Teste real: modelo",report.model,"; consultas",report.toolsUsed.join(", "),"; duração",Math.round(report.durationMs/1000),"s");
});
test("agentes: contrato restaura datas e recusa ordens duplicadas",()=>{
  const input=agentFixture();assert.ok(input.context.start instanceof Date);
  const raw=JSON.parse(JSON.stringify(input));raw.context.orders.push(raw.context.orders[0]);
  assert.equal(agentRequestSchema.safeParse(raw).success,false);
});
test("agentes: resumo mantém totais numéricos e consultas respeitam o papel",()=>{
  const box=createAgentToolbox(agentFixture("pcp"));
  const view=box.execute("consultar",{section:"programacao"});
  assert.equal(typeof view.resumo.quantidadeImpedimentos,"number");
  assert.equal(typeof view.resumo.quantidadeDadosPendentes,"number");
  const sections=box.tools[0].function.parameters.properties.section.enum;
  assert.ok(sections.includes("operacao"));assert.ok(!sections.includes("fornos"));
});
test("provedores: Qwen3 recebe controle documentado sem mutar histórico; modelo gratuito tem preço máximo zero",()=>{
  const messages=[{role:"user",content:"teste"}];
  const local=completionRequest(resolveAgentProvider("lmstudio","qwen3-8b",{},{}),messages,[]);
  assert.match(local.body.messages[0].content,/no_think/);assert.equal(messages[0].content,"teste");
  assert.equal(local.body.max_tokens,1200);
  const cloud=completionRequest(resolveAgentProvider("openrouter",undefined,{aiModel:"x:free"},{OPENROUTER_API_KEY:"test"}),messages,[]);
  assert.deepEqual(cloud.body.provider.max_price,{prompt:0,completion:0});
});
test("agentes: ferramentas não escrevem e skills exigem evidências",()=>{
  const input=agentFixture("montador"),box=createAgentToolbox(input);
  assert.throws(()=>box.execute("iniciar_producao",{}),/não permitida/);
  box.execute("consultar",{section:"programacao"});
  assert.throws(()=>box.finish(agentFindings()),/skill exige/);
  box.execute("consultar",{section:"recursos"});box.execute("consultar",{section:"fornos"});
  assert.deepEqual(box.finish(agentFindings()),agentFindings());
});
test("agentes: proposta não pode inventar ordem, fonte ou troca não calculada",()=>{
  const input=agentFixture(),box=createAgentToolbox(input);box.execute("consultar",{section:"programacao"});
  const proposal={title:"Trocar a ordem",explanation:"Conferir o efeito desta troca na carga.",steps:["Compare os horários."],orderIds:["B"],evidence:["programacao"],move:{orderId:"B",position:1,reason:"Antecipar a ordem de prazo mais próximo"}};
  assert.throws(()=>box.finish({...agentFindings(),proposals:[proposal]}),/calculada/);
  const before=JSON.stringify(input.context.orders);box.execute("simular_troca",proposal.move);
  assert.equal(box.finish({...agentFindings(),proposals:[proposal]}).proposals.length,1);
  assert.equal(JSON.stringify(input.context.orders),before);
  assert.throws(()=>box.finish({...agentFindings(),proposals:[{...proposal,orderIds:["inventada"]}]}),/inexistente/);
  assert.throws(()=>box.finish({...agentFindings(),proposals:[{...proposal,evidence:["fornos"]}]}),/não realizada/);
});
test("agentes: laço entrega resultados das ferramentas ao modelo e não aceita texto solto",async()=>{
  let calls=0;const events=[];
  const model=async(messages)=>{
    calls++;const first=calls===1;
    if(!first)assert.ok(messages.some(m=>m.role==="tool"&&m.content.includes("ordens")));
    return {model:"mock-test",choices:[{message:{role:"assistant",content:null,tool_calls:[{id:String(calls),type:"function",function:{name:first?"consultar":"concluir",arguments:JSON.stringify(first?{section:"programacao"}:agentFindings())}}]}}]};
  };
  const report=await runAgent(agentFixture(),"Skill de teste",model,new AbortController().signal,e=>events.push(e));
  assert.equal(calls,2);assert.deepEqual(report.toolsUsed,["programacao"]);assert.equal(report.model,"mock-test");assert.ok(events.length>=3);
  await assert.rejects(()=>runAgent(agentFixture(),"Skill de teste",async()=>({choices:[{message:{role:"assistant",content:"Aprovado"}}]}),new AbortController().signal,()=>{}),/não usou/);
});
const { selectPhysicalTool } = load("src/modules/planning/tool-selection.ts");
test("agentes: corrige uma resposta textual sem aceitá-la como parecer",async()=>{
  let calls=0;const events=[];
  const report=await runAgent(agentFixture(),"Skill de teste",async()=>{
    calls++;if(calls===1)return {choices:[{message:{role:"assistant",content:"texto sem ferramenta"}}]};
    return {model:"mock-repair",choices:[{message:{role:"assistant",tool_calls:[{id:String(calls),type:"function",function:{name:calls===2?"consultar":"concluir",arguments:JSON.stringify(calls===2?{section:"programacao"}:agentFindings())}}]}}]};
  },new AbortController().signal,e=>events.push(e));
  assert.equal(calls,3);assert.equal(report.model,"mock-repair");assert.ok(events.some(e=>e.message?.includes("correção de formato")));
});
const {intervalOnWindow,overviewFlags,resourceHotspots}=load("src/modules/planning/decision-system/overview.ts");
test("visão macro: recorta períodos sem alterar a escala compartilhada",()=>{
  assert.deepEqual(intervalOnWindow(0,50,25,125),{left:0,width:25});
  assert.deepEqual(intervalOnWindow(100,200,25,125),{left:75,width:25});
  assert.equal(intervalOnWindow(125,150,25,125),null);
  assert.equal(intervalOnWindow(25,25,25,125),null);
});
test("visão macro: impedimento não esconde atraso e recursos contam ordens únicas",()=>{
  const {simulation}=runCandidate(fixture(),decisionPresets[0]);
  const item=simulation.machines[0].items[0];
  item.dueDate="2020-01-01";
  item.resourceConflicts=[{severity:"blocking",resourceCode:"250X170"},{severity:"blocking",resourceCode:"250X170"}];
  assert.equal(overviewFlags(item).late,true);
  assert.equal(overviewFlags(item).blocked,true);
  assert.equal(resourceHotspots([item])[0].ids.length,1);
});
const {movePlannedOrder}=load("src/modules/planning/decision-system/sequence-change.ts");
test("ajuste por imprevisto exige motivo e preserva as ordens",()=>{
  const input=fixture().orders;
  assert.throws(()=>movePlannedOrder(input,"B",1,""),/motivo/);
  const changed=movePlannedOrder(input,"B",1,"Ferramenta aguardando liberação do forno");
  assert.equal(changed.orders.find(o=>o.id==="B").sequence,1);
  assert.equal(input.find(o=>o.id==="B").sequence,2);
  assert.deepEqual(changed.orders.map(o=>o.id).sort(),input.map(o=>o.id).sort());
  assert.equal(changed.change.from,2);
  assert.equal(changed.change.to,1);
});
test("ajuste não move nem ultrapassa ordem iniciada",()=>{
  const orders=fixture().orders;
  orders[0].status="in_progress";
  assert.throws(()=>movePlannedOrder(orders,"A",2,"Motivo de teste válido"),/iniciada/);
  assert.throws(()=>movePlannedOrder(orders,"B",1,"Motivo de teste válido"),/iniciada/);
  assert.throws(()=>movePlannedOrder(orders,"B",5,"Motivo de teste válido"),/posição válida/);
});
test("ajuste recalcula horários sem liberar recursos físicos",()=>{
  const context=fixture();
  context.resources.carcasses[0].capacity=0;
  const changed=movePlannedOrder(context.orders,"B",1,"Priorizar pedido após conferência");
  const candidate=runCandidate(context,decisionPresets[0],changed.orders);
  assert.equal(candidate.orderIds["18"][0],"B");
  assert.equal(candidate.evaluation.status,"blocked");
});
const {loadHelp,findLoadHelp} = load("src/modules/planning/load-help.ts");
test("ajuda: todos os assuntos têm explicação, efeito e passos", () => {
  for(const [id,topic] of Object.entries(loadHelp)) {
    assert.ok(topic.title && topic.summary && topic.effect,id);
    assert.ok(topic.steps.length>0 && topic.steps.every(step=>step.length>10),id);
  }
});
test("ajuda: busca funciona sem acentos e com mais de uma palavra", () => {
  assert.ok(findLoadHelp("producao liquida").some(([key])=>key==="netTime"));
  assert.ok(findLoadHelp("carcaca").some(([key])=>key==="carcass"));
  assert.deepEqual(findLoadHelp("assuntoinexistentexyz"),[]);
});
test("ajuda: cobre os oito pesos e diferencia limiar de furos", () => {
  const {metricKeys}=load("src/modules/planning/decision-system/schema.ts");
  for(const key of metricKeys) assert.ok(loadHelp[key]);
  assert.notEqual(loadHelp.highHoles.title,loadHelp.highHolesThreshold.title);
  assert.match(loadHelp.weights.effect,/não precisam somar 100/);
});
test("linguagem: preserva dados, alertas e contrato estruturado da IA", () => {
  const {OPERATOR_LANGUAGE_GUIDE}=load("src/modules/planning/operator-language.ts");
  assert.match(OPERATOR_LANGUAGE_GUIDE,/Preserve todos os fatos/);
  assert.match(OPERATOR_LANGUAGE_GUIDE,/formato JSON/);
  assert.match(OPERATOR_LANGUAGE_GUIDE,/ressalva de segurança/);
});
const { decisionPresets, profileSchema } = load("src/modules/planning/decision-system/schema.ts");
const { runCandidate, compareCandidates, optimizeDecisions, buildScenarioComparison, scenarioKpis } = load("src/modules/planning/decision-system/optimizer.ts");
const { evaluateDecision } = load("src/modules/planning/decision-system/engine.ts");
function fixture() {
  const start = new Date("2026-09-07T09:00:00");
  const order = (id, sequence, dueDate) => ({
    id, orderNumber:id, planCode:"TESTE", machineCode:"18", toolCode:id,
    alloyCode:"6060", alternativeAlloys:[], targetKg:1300, producedKg:0,
    sequence, dueDate, status:"planned", productivityKgH:1300, productivitySource:"ficha",
    toolReadyAt:start, toolHeatingState:"released", holes:2, boCode:"1", carcassCode:"250X170"
  });
  const setting = { billetBarWeightKg:415, extrusionEfficiency:0.85, defaultProductivityKgH:1300,
    setupMinutes:0, alloyChangeMinutes:0, toolHeatingMinutes:0, ovenCount:1, ovenSlotsPerOven:7, ovenSlots:7 };
  return { start, orders:[order("A",1,"2026-09-08"),order("B",2,"2026-09-07T10:10:00")],
    settings:{"18":setting}, shifts:[{id:"day",code:"A",name:"Dia",startTime:"08:00",endTime:"17:00",breakMinutes:0,machineCodes:["18"],isActive:true}],
    unavailable:[], resources:{carcasses:[{code:"250X170",capacity:10,reservations:[]}],bos:[{code:"1",capacity:10,reservations:[]}]},
    stock:[{alloyCode:"6060",availableBars:100,barWeightKg:415}],stockKnown:true };
}
test("datas: prazo com horário não é descartado; data sem horário termina no fim do dia", () => {
  const {dueAt, lateMinutes} = load("src/modules/planning/decision-system/dates.ts");
  assert.equal(dueAt("2026-09-07").getHours(),23);
  assert.equal(lateMinutes("2026-09-07T10:00:00",new Date("2026-09-07T11:00:00")),60);
  assert.equal(dueAt("inválido"),null);
});
test("restrição obrigatória prevalece sobre nota e peso zero", () => {
  const context=fixture(), profile=structuredClone(decisionPresets[0]);
  const baseline=runCandidate(context,profile);
  profile.customCriteria=[{id:"limite",name:"Teste obrigatório",description:"Teste",module:"sequencing",kind:"hard",enabled:true,weight:0,penalty:0,priority:1,consecutive:1,conditions:[{fact:"remainingKg",operator:"gt",value:1000}]}];
  const blocked=runCandidate(context,profile);
  assert.equal(blocked.evaluation.status,"blocked");
  assert.equal(blocked.evaluation.hardViolations,2);
  assert.ok(compareCandidates(baseline,blocked)<0);
  assert.equal(blocked.evaluation.traces[0].ruleHits[0].name,"Teste obrigatório");
});
test("estoque desconhecido não é confundido com disponibilidade ou falta física", () => {
  const context=fixture(), profile=decisionPresets[0], result=runCandidate(context,profile);
  assert.equal(result.evaluation.status,"viable");
  assert.equal(evaluateDecision(result.simulation,profile,[],false).status,"unconfirmed");
  assert.equal(evaluateDecision(result.simulation,profile,[],true).status,"blocked");
});
test("perfis: validação recusa ids repetidos e pesos todos zerados", () => {
  const profile=structuredClone(decisionPresets[0]);
  for (const key of Object.keys(profile.weights)) profile.weights[key]=0;
  assert.equal(profileSchema.safeParse(profile).success,false);
  assert.equal(profileSchema.safeParse(decisionPresets[0]).success,true);
});
test("revezamento: penaliza sem bloquear ferramenta acima do limite de furos", () => {
  const context = fixture();
  context.orders = [{ ...context.orders[0], id: "mesa-cheia", toolCode: "T-MESA", targetKg: 5_200, holes: 3, sequence: 1 }];
  const profile = structuredClone(decisionPresets[0]);
  profile.thresholds.handoverMaxHoles = 2;
  const candidate = runCandidate(context, profile);
  assert.equal(candidate.evaluation.metrics.handoverHighHoles, 1);
  assert.equal(candidate.evaluation.status, "viable");
  assert.match(candidate.evaluation.traces[0].reasons.join(" "), /Revezamento 11:00–13:30/);
  assert.ok(candidate.evaluation.tradeoffs.some((item) => item.includes("revezamento")));
});
test("otimização recalcula, reduz atraso e não perde nem transfere ordens", () => {
  const context=fixture(), candidates=optimizeDecisions(context,decisionPresets[1],2000);
  assert.ok(candidates.length>1);
  assert.ok(candidates.some(c=>c.evaluation.metrics.lateMinutes<candidates[0].evaluation.metrics.lateMinutes));
  for (const candidate of candidates) assert.deepEqual([...candidate.orderIds["18"]].sort(),["A","B"]);
});
test("cenários: Simplificada é baseline imutável e todos usam o mesmo snapshot", () => {
  const context = fixture();
  const before = JSON.stringify(context.orders);
  const first = buildScenarioComparison(context, decisionPresets[0], 120);
  const second = buildScenarioComparison(context, decisionPresets[0], 120);
  assert.deepEqual(first.scenarios.map(item => item.id), ["original", "material_efficiency", "max_throughput", "balanced"]);
  assert.equal(first.scenarios[0].source, "simplificada");
  assert.deepEqual(first.scenarios[0].sequence["18"], ["A", "B"]);
  assert.equal(JSON.stringify(context.orders), before);
  assert.equal(new Set(first.scenarios.map(item => item.inputHash)).size, 1);
  assert.deepEqual(first.scenarios.map(item => item.sequence), second.scenarios.map(item => item.sequence));
  assert.equal(first.scenarios.every(item => item.candidate.evaluation.shiftGoals.goals.targetKg === 25_000), true);
  for (const scenario of first.scenarios.slice(1)) {
    assert.equal(scenario.deltaFromBaseline.projectedKg, scenario.kpis.projectedKg - first.scenarios[0].kpis.projectedKg);
    assert.equal(scenario.deltaFromBaseline.averageProductivityKgH, scenario.kpis.averageProductivityKgH - first.scenarios[0].kpis.averageProductivityKgH);
  }
});
test("cenários: previsão de produtividade é a média das ferramentas da Simplificada", () => {
  const context = fixture();
  context.orders[0].productivityKgH = 1000;
  context.orders[1].productivityKgH = 1500;
  const candidate = runCandidate(context, decisionPresets[0]);
  const press = scenarioKpis(candidate).pressPlans.find((item) => item.machineCode === "18");
  assert.ok(press);
  const items = candidate.simulation.machines.find((machine) => machine.machineCode === "18").items;
  assert.equal(press.plannedKg, items.reduce((total, item) => total + item.remainingKg, 0));
  assert.equal(press.productivitySampleCount, items.length);
  assert.equal(press.plannedVolumeKgH, items.reduce((total, item) => total + item.productivityKgH, 0) / items.length);
  assert.equal(press.workMinutes, press.plannedKg / press.plannedVolumeKgH * 60);
  assert.equal(press.toolChangeMinutes, Math.max(items.length - 1, 0));
  assert.equal(candidate.simulation.machines.find((machine) => machine.machineCode === "18").waitingMinutes, 0);
  assert.ok(press.scheduledMinutes >= press.workMinutes);
  assert.equal(press.turnsRequired, Math.ceil(press.workMinutes / 580));
});
test("saldo de material conserva a massa necessária na simulação", () => {
  const {simulation}=runCandidate(fixture(),decisionPresets[0]);
  for (const billet of simulation.billets)
    assert.ok(Math.abs(billet.loadedKg-billet.rawRequiredKg-billet.endingBalanceKg)<0.01);
});
test("material: liga alternativa usa o saldo cronológico compartilhado entre prensas", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T08:00:00Z");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85,
    defaultProductivityKgH: 1300, setupMinutes: 0, alloyChangeMinutes: 0,
    toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const order = (id, machineCode, alloyCode, alternativeAlloys, targetKg) => ({
    id, orderNumber: id, planCode: "TESTE", machineCode, toolCode: `T-${id}`,
    alloyCode, alternativeAlloys, targetKg, producedKg: 0, sequence: 1,
    dueDate: null, status: "planned", productivityKgH: 1300,
    productivitySource: "ficha", toolReadyAt: start, toolHeatingState: "released",
    carcassCode: null, boCode: null,
  });
  const simulation = simulateMachineLoad([
    // Deliberately listed first to prove the result is based on start time, not input order.
    order("z-later", "18", "6063", ["6060"], 200),
    order("a-earlier", "19", "6060", [], 100),
  ], { "18": setting, "19": setting }, start, "fifo", [{
    id: "day", code: "A", name: "Dia", startTime: "00:00", endTime: "23:59",
    breakMinutes: 0, machineCodes: [], isActive: true,
  }]);
  const later = simulation.machines.flatMap((machine) => machine.items)
    .find((item) => item.id === "z-later");
  assert.equal(later.selectedAlloy, "6060");
  const [billet] = simulation.billets;
  assert.equal(billet.alloyCode, "6060");
  assert.equal(billet.bars, 1);
  assert.ok(Math.abs(billet.loadedKg - billet.rawRequiredKg - billet.endingBalanceKg) < 0.01);
});
const { evaluateShiftGoals, planningShiftGoals } = load("src/modules/planning/decision-system/shift-goals.ts");
test("metas de turno: mede o conjunto das prensas e inclui tempo calendarizado", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const order = (id, machineCode) => ({ id, orderNumber: id, planCode: "META", machineCode, toolCode: `T-${id}`,
    alloyCode: "6060", alternativeAlloys: [], targetKg: 12_567, producedKg: 0, sequence: 1, dueDate: null,
    status: "planned", productivityKgH: 1500, productivitySource: "ficha", toolReadyAt: start,
    toolHeatingState: "released", carcassCode: null, boCode: null });
  const simulation = simulateMachineLoad([order("A", "18"), order("B", "19")], { "18": setting, "19": setting }, start, "fifo", [{
    id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: [], isActive: true,
  }]);
  const report = evaluateShiftGoals(simulation);
  assert.equal(report.goals, planningShiftGoals);
  assert.equal(report.shifts.length, 1);
  assert.ok(report.shifts[0].projectedKg >= 25_000);
  assert.ok(report.shifts[0].averageProductivityKgH >= 1_300);
  assert.equal(report.shifts[0].meetsVolumeTarget, true);
  assert.equal(report.shifts[0].meetsProductivityTarget, true);
  assert.equal(report.shifts[0].presses.length, 2);
  assert.equal(report.presses.length, 2);
  assert.deepEqual(report.presses.map((press) => press.shiftCount), [1, 1]);
  const evaluation = evaluateDecision(simulation, decisionPresets[0], [{ alloyCode: "6060", availableBars: 100 }]);
  assert.equal(evaluation.shiftGoals.shiftsMeetingBothTargets, 1);
});
test("metas de turno: uma prensa abaixo da meta não é escondida pela outra", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const order = (id, machineCode, productivityKgH) => ({ id, orderNumber: id, planCode: "META", machineCode, toolCode: `T-${id}`,
    alloyCode: "6060", alternativeAlloys: [], targetKg: 12_567, producedKg: 0, sequence: 1, dueDate: null,
    status: "planned", productivityKgH, productivitySource: "ficha", toolReadyAt: start,
    toolHeatingState: "released", carcassCode: null, boCode: null });
  const simulation = simulateMachineLoad([order("rápida", "18", 1500), order("lenta", "19", 1100)], { "18": setting, "19": setting }, start, "fifo", [{
    id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: [], isActive: true,
  }]);
  const report = evaluateShiftGoals(simulation);
  const shift = report.shifts[0];
  assert.equal(shift.presses.find((press) => press.machineCode === "18").meetsProductivityTarget, true);
  assert.equal(shift.presses.find((press) => press.machineCode === "19").meetsProductivityTarget, false);
  assert.equal(shift.meetsProductivityTarget, false);
  assert.equal(report.pressesBelowProductivityTarget, 1);
});
test("produtividade: separa extrusão técnica, operação e NO_LOAD", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 30, alloyChangeMinutes: 0, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const simulation = simulateMachineLoad([{ id: "short", orderNumber: "short", planCode: "META", machineCode: "18", toolCode: "T-short",
    alloyCode: "6060", alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence: 1, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: start, toolHeatingState: "released", carcassCode: null, boCode: null }],
    { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: [], isActive: true }]);
  const report = evaluateShiftGoals(simulation);
  const metrics = report.productivity;
  assert.ok(metrics.technicalKgH >= 1299 && metrics.technicalKgH <= 1301);
  assert.ok(metrics.operationalKgH < metrics.technicalKgH);
  assert.ok(metrics.noLoadMinutes > 0);
  assert.ok(metrics.effectiveKgH < metrics.technicalKgH);
});
test("trocas: preparação inicial não se repete a cada ferramenta", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 20, toolChangeMinutes: 1, alloyChangeMinutes: 15, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const order = (id, sequence, alloyCode) => ({ id, orderNumber: id, planCode: "TROCA", machineCode: "18", toolCode: `T-${id}`,
    alloyCode, alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: start, toolHeatingState: "released", carcassCode: null, boCode: null });
  const simulation = simulateMachineLoad([order("A", 1, "6060"), order("B", 2, "6060"), order("C", 3, "6063")], { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: ["18"], isActive: true }]);
  assert.deepEqual(simulation.machines[0].items.map((item) => item.preparationMinutes), [20, 1, 16]);
});
test("produtividade: parada de prensa reduz disponibilidade sem virar NO_LOAD", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const simulation = simulateMachineLoad([{ id: "stop", orderNumber: "stop", planCode: "META", machineCode: "18", toolCode: "T-stop",
    alloyCode: "6060", alternativeAlloys: [], targetKg: 12_000, producedKg: 0, sequence: 1, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: start, toolHeatingState: "released", carcassCode: null, boCode: null }],
    { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: [], isActive: true }],
    [{ id: "maintenance", resourceType: "press", resourceCode: "18", startsAt: new Date("2026-09-07T08:00:00"), endsAt: new Date("2026-09-07T09:00:00"), reason: "Manutenção planejada", status: "active" }]);
  const metrics = evaluateShiftGoals(simulation).productivity;
  assert.equal(Math.round(metrics.plannedStopMinutes), 60);
  assert.equal(Math.round(metrics.unplannedStopMinutes), 0);
  assert.equal(Math.round(metrics.availabilityPercent), 95);
  assert.ok(metrics.noLoadMinutes >= 0);
});
test("forno: ferramenta sem ciclo entra perto da necessidade da prensa", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-30T21:00:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 240, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const simulation = simulateMachineLoad([{ id: "just-in-time", orderNumber: "JIT", planCode: "META", machineCode: "18", toolCode: "T-JIT",
    alloyCode: "6060", alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence: 1, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: null, toolHeatingState: "waiting", carcassCode: null, boCode: null }],
    { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: [], isActive: true }]);
  const item = simulation.machines[0].items[0];
  // Datas de turno são locais; o ambiente de teste as serializa em UTC (-03:00).
  assert.equal(item.toolHeatingStartAt.toISOString(), "2026-10-01T05:30:00.000Z");
  assert.equal(item.calculatedToolReadyAt.toISOString(), "2026-10-01T09:30:00.000Z");
});
test("forno: posições físicas permitem aquecimento paralelo e preservam a vaga até a extrusão", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-10-01T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 20, alloyChangeMinutes: 0, toolHeatingMinutes: 240, ovenCount: 3, ovenSlotsPerOven: 7, ovenSlots: 21 };
  const order = (index) => ({ id: `parallel-${index}`, orderNumber: `parallel-${index}`, planCode: "FORNO", machineCode: "18", toolCode: `T-${index}`,
    alloyCode: "6060", alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence: index, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: new Date(start.getTime() + 240 * 60000), toolHeatingState: "heating",
    toolOvenCode: `F${Math.ceil(index / 7)}`, toolOvenPosition: (index - 1) % 7 + 1, toolHeatingEnteredAt: start, carcassCode: null, boCode: null });
  const simulation = simulateMachineLoad(Array.from({ length: 10 }, (_, index) => order(index + 1)), { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "00:00", endTime: "23:59", breakMinutes: 0, machineCodes: ["18"], isActive: true }]);
  const items = simulation.machines[0].items;
  assert.equal(new Set(items.map(item => `${item.ovenCode}:${item.ovenPosition}`)).size, 10);
  assert.ok(items.every(item => item.toolOvenExitAt?.getTime() === item.extrusionStartAt.getTime()));
  assert.ok(items.every(item => item.readyWaitingMinutes >= 0));
});
test("forno: nunca ultrapassa 21 posições ao programar mais ferramentas que a capacidade", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-10-01T06:30:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 240, ovenCount: 3, ovenSlotsPerOven: 7, ovenSlots: 21 };
  const orders = Array.from({ length: 22 }, (_, index) => ({ id: `queued-${index}`, orderNumber: `queued-${index}`, planCode: "FORNO", machineCode: "18", toolCode: `Q-${index}`,
    alloyCode: "6060", alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence: index + 1, dueDate: null, status: "planned",
    productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: null, toolHeatingState: "waiting", carcassCode: null, boCode: null }));
  const simulation = simulateMachineLoad(orders, { "18": setting }, start, "fifo", [{ id: "day", code: "A", name: "Dia", startTime: "00:00", endTime: "23:59", breakMinutes: 0, machineCodes: ["18"], isActive: true }]);
  const items = simulation.machines[0].items;
  const peak = Math.max(...items.map(point => items.filter(item => item.toolHeatingStartAt && item.toolOvenExitAt && item.toolHeatingStartAt <= point.calculatedToolReadyAt && item.toolOvenExitAt > point.calculatedToolReadyAt).length));
  assert.ok(peak <= 21);
  assert.ok(items[21].toolHeatingStartAt >= items[0].toolHeatingStartAt);
});
test("hora extra: amplia somente a janela autorizada, sem criar um novo turno", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-30T16:10:00");
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1300,
    setupMinutes: 0, alloyChangeMinutes: 0, toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 2, ovenSlots: 2 };
  const order = { id: "extra", orderNumber: "extra", planCode: "EXTRA", machineCode: "18", toolCode: "T-EXTRA",
    alloyCode: "6060", alternativeAlloys: [], targetKg: 1300, producedKg: 0, sequence: 1, dueDate: null,
    status: "planned", productivityKgH: 1300, productivitySource: "ficha", toolReadyAt: start,
    toolHeatingState: "released", carcassCode: null, boCode: null };
  const shifts = [{ id: "b", code: "TB", name: "Turno B", startTime: "06:30", endTime: "16:10", breakMinutes: 0, machineCodes: ["18"], isActive: true }];
  const result = simulateMachineLoad([order], { "18": setting }, start, "fifo", shifts, [], { carcasses: [], bos: [] }, [{
    id: "extra-30", date: "2026-09-30", startTime: "16:10", endTime: "18:10", machineCodes: ["18"], reason: "Complementar carga aprovada", isActive: true,
  }]);
  const item = result.machines[0].items[0];
  assert.equal(item.startAt.getHours(), 16);
  assert.equal(item.endAt.getHours(), 17);
  assert.equal(item.endAt.getDate(), 30);
});
test("produtividade: formatos brasileiros, histórico e limite físico", () => {
  for (const [value, expected] of [[1300, 1300], ["1.300", 1300], ["1.300,5", 1300.5],
    ["1300.5", 1300.5], ["1.300 kg/h", 1300], ["1479/1290/", 1384.5], [2500, 2500]]) {
    assert.equal(productivity.normalizeProductivityKgH(value), expected);
  }
  for (const value of [null, "", 0, -1, 2501, 29523.853, 94933.152, Infinity, "texto"]) {
    assert.equal(productivity.normalizeProductivityKgH(value), null);
    assert.equal(productivity.safeProductivityKgH(value), 1300);
  }
  assert.equal(productivity.guardProductivityKgH(7, "6060"), 1300);
  assert.equal(productivity.guardProductivityKgH(350, "6061"), 450);
  assert.equal(productivity.guardProductivityKgH(700, "6082"), 700);
  assert.equal(productivity.guardProductivityKgH(350, "7075"), 1300);
  assert.equal(productivity.guardProductivityKgH(1400, "6063"), 1400);
});
test("carcaça: sequência física 008, código normalizado e cadastro depois da primeira página", () => {
  const tool = (sequence, carcass, available = false) => ({
    code: "HIST:TCG-012:" + sequence, matrix_code: "TCG-012",
    sequence_number: sequence, source_available: available, carcass_code: carcass,
  });
  const tools = [...Array.from({ length: 1200 }, (_, i) => ({ ...tool(i, "228X130"), matrix_code: "OUTRA" })),
    tool(1, "232X228"), tool(4, "228X170"), tool(8, "250X170", true)];
  assert.equal(selectPhysicalTool(tools, "tcg012", 8).carcass_code, "250X170");
  assert.equal(selectPhysicalTool(tools, "TCG-012", null).sequence_number, 8);
  assert.equal(selectPhysicalTool(tools, "TCG-012", 14), undefined);
  assert.equal(selectPhysicalTool([tool(1, "232X228"), tool(4, "228X170")], "TCG-012", null), undefined);
});
test("motor usa 1.300 kg/h quando a entrada é inválida", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T09:00:00Z");
  const order = {
    id: "test", orderNumber: "test", planCode: "test", machineCode: "18",
    toolCode: "TCG-012", alloyCode: "6060", alternativeAlloys: [], targetKg: 1300,
    producedKg: 0, sequence: 1, dueDate: null, status: "planned",
    productivityKgH: 94933, productivitySource: "simplificada",
    toolReadyAt: start, toolHeatingState: "released", carcassCode: "250X170",
  };
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85,
    defaultProductivityKgH: 1300, setupMinutes: 0, alloyChangeMinutes: 0,
    toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 7, ovenSlots: 7 };
  const shifts = [{ id: "test", code: "A", name: "Teste", startTime: "00:00",
    endTime: "23:59", breakMinutes: 0, machineCodes: ["18"], isActive: true }];
  const result = simulateMachineLoad([order], { "18": setting }, start, "fifo", shifts, [],
    { carcasses: [{ code: "250X170", capacity: 0, totalQuantity: 24,
      unavailableQuantity: 24, reservations: [] }], bos: [] });
  const item = result.machines[0].items[0];
  assert.equal(item.productivityKgH, 1300);
  assert.equal(item.theoreticalMinutes, 60);
  assert.match(item.resourceConflicts.find(c => c.type === "carcass-capacity").message,
    /cadastrada no estoque físico.*24/);
});
