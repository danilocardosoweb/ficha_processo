export type OrderStatus =
  "planned" | "released" | "in_progress" | "paused" | "completed" | "cancelled";

export interface ProductionOrder {
  id: string;
  organization_id: string;
  import_batch_id: string | null;
  order_number: string;
  plan_code: string | null;
  machine_code: string;
  tool_code: string;
  product_code: string | null;
  product_description: string | null;
  customer_name: string | null;
  alloy_code: string;
  temper: string | null;
  target_kg: number | null;
  produced_kg: number;
  produced_quantity?: number;
  target_quantity: number | null;
  actual_start?: string | null;
  actual_end?: string | null;
  started_by_name?: string | null;
  completed_by_name?: string | null;
  reopened_at?: string | null;
  reopened_by_name?: string | null;
  reprogram_count?: number;
  last_status_reason?: string | null;
  demand_unit?: "kg" | "pieces" | "bars";
  is_active?: boolean;
  due_date: string | null;
  sequence: number;
  status: OrderStatus;
  notes: string | null;
  source_data: Record<string, unknown>;
  holes?: number | null;
  bo_code?: string | null;
  carcass_code?: string | null;
  package_measure_mm?: number | null;
  carcass_diameter_mm?: number | null;
  created_at: string;
  updated_at: string;
}

export interface SimplifiedQueue {
  id: string;
  plan_code: string | null;
  machine_code: string | null;
  file_name: string;
  created_at: string;
  processed_at?: string | null;
  is_active: boolean;
  status: "pending" | "processing" | "processed" | "failed";
  production_status?: "queued" | "in_progress" | "completed" | "cancelled";
  production_started_at?: string | null;
  production_completed_at?: string | null;
  production_completed_by_name?: string | null;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
  deletion_reason?: string | null;
  production_orders: ProductionOrder[];
}

export interface SimplifiedRow {
  ordem: string;
  plano: string;
  prensa: string;
  ferramenta: string;
  perfil: string;
  cliente: string;
  liga: string;
  tempera: string;
  kg: number;
  data: string;
  item?: string;
  sequencia?: string;
  furos?: number;
  bo?: string;
  medidaPacote?: number;
  diametro?: number;
  bat?: string;
  box?: string;
  pc?: string;
  st?: string;
  departamento?: string;
  observacao?: string;
  entradaForno?: string;
  saidaForno?: string;
  sourceRow?: number;
  ativa: boolean;
  unidade: "kg" | "pieces" | "bars";
  quantidade?: number;
  ultimaProdutividadeKgH?: number;
}

export type PcpImportType = "order_portfolio" | "planning_history";

export interface PcpImportBatch {
  id: string;
  organization_id: string;
  import_type: PcpImportType;
  file_name: string;
  source_sheet: string | null;
  row_count: number;
  status: "processing" | "processed" | "failed";
  imported_by_name: string;
  imported_at: string;
  processed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface OrderPortfolioRow {
  id: number;
  import_batch_id: string;
  source_row: number;
  order_key: string;
  order_number: string;
  customer_name: string | null;
  customer_order_number: string | null;
  implantation_date: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  product_code: string | null;
  tool_code: string | null;
  service_unit: "kg" | "pieces" | null;
  ordered_kg: number;
  ordered_pieces: number;
  balance_kg: number;
  balance_pieces: number;
  committed_kg: number;
  committed_pieces: number;
  produced_kg: number;
  produced_pieces: number;
  packed_kg: number;
  packed_pieces: number;
  invoiced_kg: number;
  invoiced_pieces: number;
  priority: number | null;
  alloy_code: string | null;
  temper: string | null;
  status: string | null;
  item_status: string | null;
  special_conditions: string | null;
}

export interface PlanningHistoryRow {
  id: number;
  import_batch_id: string;
  source_row: number;
  order_key: string;
  order_number: string;
  customer_name: string | null;
  product_code: string | null;
  tool_code: string | null;
  programming_date: string | null;
  due_date: string | null;
  service_unit: "kg" | "pieces" | null;
  plan_code: string | null;
  plan_date: string | null;
  planned_kg: number;
  planned_pieces: number;
  fulfilled_kg: number;
  fulfilled_pieces: number;
}
