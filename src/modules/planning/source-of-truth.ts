/**
 * Fonte central das premissas de planejamento.
 *
 * Os documentos de negócio permanecem legíveis em docs/. Este arquivo é a
 * tradução versionada das premissas que podem ser consumidas pelo código e
 * pelos pacotes enviados aos analistas. Nunca use uma premissa PENDENTE como
 * fato operacional: ela precisa aparecer como limitação da análise.
 */
export const PLANNING_SPEC_VERSION = "2026-09-29";

export type ParameterStatus = "CONFIRMADO" | "SUGERIDO" | "PENDENTE";

/**
 * Define em qual denominador a meta de kg/h deve ser comparada.
 *
 * A base continua explícita porque a operação ainda precisa confirmar se os
 * 1.300 kg/h representam uma média por prensa no turno ou uma velocidade
 * somente durante a extrusão. O motor calcula as três visões em paralelo.
 */
export type ProductivityBasis = "PER_PRESS_GROSS" | "PER_PRESS_NET" | "TOTAL_GROSS";

export type PlanningParameter<T> = {
  value: T;
  status: ParameterStatus;
  source: "planning-spec" | "parametros-e-pendencias";
  note?: string;
};

export const planningSourceManifest = {
  specVersion: PLANNING_SPEC_VERSION,
  documents: [
    { id: "planning-spec", title: "planning-spec.md", authority: "principal" },
    { id: "parameters", title: "parametros-e-pendencias.md", authority: "configuração" },
    { id: "agent-rules", title: "AGENTS.md", authority: "implementação" },
  ],
} as const;

/** Valores usados somente como ponto de partida, com a origem explícita. */
export const planningParameters = {
  planning: {
    planHorizonHours: { value: 48, status: "SUGERIDO", source: "parametros-e-pendencias" },
    lookAheadDepth: { value: 4, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    lookAheadHours: { value: 8, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    maxCandidatesPerMachine: { value: 5, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    beamWidth: { value: 5, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    maxNodesBudget: { value: 5000, status: "SUGERIDO", source: "parametros-e-pendencias" },
    frozenMinutes: { value: 60, status: "SUGERIDO", source: "parametros-e-pendencias" },
  },
  heating: {
    defaultHeatingMinutes: { value: 240, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    maxOvenWaitMinutes: { value: null, status: "PENDENTE", source: "parametros-e-pendencias", note: "Tempo máximo de espera após aquecimento ainda não confirmado." },
  },
  orders: {
    smallOrderKg: { value: 300, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    allowSplitOrders: { value: null, status: "PENDENTE", source: "parametros-e-pendencias" },
  },
  resources: {
    ovensPerPress: { value: 3, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    positionsPerOven: { value: 7, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    boMapping: { value: null, status: "PENDENTE", source: "parametros-e-pendencias", note: "Compatibilidade ferramenta → BO precisa de cadastro confirmado." },
    carcassMapping: { value: null, status: "PENDENTE", source: "parametros-e-pendencias", note: "Substituições de carcaça precisam de confirmação." },
  },
  labor: {
    capacityByShift: { value: null, status: "PENDENTE", source: "parametros-e-pendencias" },
    lunchStart: { value: "11:00", status: "CONFIRMADO", source: "parametros-e-pendencias" },
    lunchEnd: { value: "13:30", status: "CONFIRMADO", source: "parametros-e-pendencias" },
    handoverMaxHoles: { value: 2, status: "SUGERIDO", source: "planning-spec", note: "No revezamento, priorizar ferramentas de até 2 furos; o perfil pode elevar o limite até 4 quando a operação confirmar capacidade de mesa e equipe." },
  },
  calendar: {
    timezone: { value: "America/Sao_Paulo", status: "SUGERIDO", source: "parametros-e-pendencias" },
    shifts: { value: null, status: "PENDENTE", source: "parametros-e-pendencias" },
  },
  goals: {
    shiftStartTime: { value: "06:30", status: "CONFIRMADO", source: "parametros-e-pendencias" },
    shiftEndTime: { value: "16:10", status: "CONFIRMADO", source: "parametros-e-pendencias" },
    targetKgPerShift: { value: 25_000, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    targetProductivityKgH: { value: 1_300, status: "CONFIRMADO", source: "parametros-e-pendencias" },
    productivityBasis: {
      value: "PER_PRESS_GROSS" as ProductivityBasis,
      status: "SUGERIDO",
      source: "parametros-e-pendencias",
      note: "Confirmar se a meta de 1.300 kg/h é por prensa sobre a janela do turno ou somente durante a extrusão.",
    },
  },
} as const satisfies Record<string, Record<string, PlanningParameter<unknown>>>;

export function unresolvedPlanningAssumptions() {
  const assumptions: string[] = [];
  for (const group of Object.values(planningParameters)) {
    for (const parameter of Object.values(group)) {
      if (parameter.status === "PENDENTE" && parameter.note) assumptions.push(parameter.note);
    }
  }
  return assumptions;
}

export const planningEngineDefaults = {
  lookAheadDepth: planningParameters.planning.lookAheadDepth.value,
  beamWidth: planningParameters.planning.beamWidth.value,
  maxCandidatesPerMachine: planningParameters.planning.maxCandidatesPerMachine.value,
  maxNodesBudget: planningParameters.planning.maxNodesBudget.value,
  lowVolumeKg: planningParameters.orders.smallOrderKg.value,
  defaultHeatingMinutes: planningParameters.heating.defaultHeatingMinutes.value,
  ovenSlotsPerPress:
    planningParameters.resources.ovensPerPress.value *
    planningParameters.resources.positionsPerOven.value,
  shiftStartTime: planningParameters.goals.shiftStartTime.value,
  shiftEndTime: planningParameters.goals.shiftEndTime.value,
  targetKgPerShift: planningParameters.goals.targetKgPerShift.value,
  targetProductivityKgH: planningParameters.goals.targetProductivityKgH.value,
  productivityBasis: planningParameters.goals.productivityBasis.value,
  handoverStartTime: planningParameters.labor.lunchStart.value,
  handoverEndTime: planningParameters.labor.lunchEnd.value,
  handoverMaxHoles: planningParameters.labor.handoverMaxHoles.value,
} as const;
