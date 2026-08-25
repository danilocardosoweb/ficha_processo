import type { ProductionOrder } from "@/types/database";

export const orders: ProductionOrder[] = [
  { id:"1", organization_id:"demo", import_batch_id:null, order_number:"126330010", plan_code:"P1800-01", machine_code:"P1800", tool_code:"TP-8221", product_code:"PF-30118", product_description:"Perfil estrutural 76 mm", customer_name:"ALUGERAIS", alloy_code:"6060", temper:"T5", target_kg:1200, produced_kg:684, target_quantity:480, due_date:"2026-08-21", sequence:1, status:"in_progress", notes:null, source_data:{}, created_at:"2026-08-20", updated_at:"2026-08-21" },
  { id:"2", organization_id:"demo", import_batch_id:null, order_number:"126330011", plan_code:"P1800-01", machine_code:"P1800", tool_code:"TQ-2015", product_code:"PF-00842", product_description:"Marco de janela 32 mm", customer_name:"ALUMAX", alloy_code:"6060", temper:"T5", target_kg:583, produced_kg:0, target_quantity:320, due_date:"2026-08-21", sequence:2, status:"released", notes:null, source_data:{}, created_at:"2026-08-20", updated_at:"2026-08-20" },
  { id:"3", organization_id:"demo", import_batch_id:null, order_number:"126330012", plan_code:"P2500-03", machine_code:"P2500", tool_code:"TP-4410", product_code:"PF-10422", product_description:"Travessa industrial 90 mm", customer_name:"METALFORT", alloy_code:"6063", temper:"T6", target_kg:1850, produced_kg:1850, target_quantity:650, due_date:"2026-08-20", sequence:1, status:"completed", notes:null, source_data:{}, created_at:"2026-08-19", updated_at:"2026-08-20" },
  { id:"4", organization_id:"demo", import_batch_id:null, order_number:"126330013", plan_code:"P1800-01", machine_code:"P1800", tool_code:"TP-7731", product_code:"PF-22015", product_description:"Perfil fachada leve", customer_name:"VIDRAL", alloy_code:"6060", temper:"T5", target_kg:940, produced_kg:0, target_quantity:410, due_date:"2026-08-22", sequence:3, status:"planned", notes:null, source_data:{}, created_at:"2026-08-20", updated_at:"2026-08-20" },
  { id:"5", organization_id:"demo", import_batch_id:null, order_number:"126330014", plan_code:"P2500-03", machine_code:"P2500", tool_code:"TQ-1912", product_code:"PF-31124", product_description:"Longarina solar 120 mm", customer_name:"SOLARTECH", alloy_code:"6005A", temper:"T6", target_kg:2300, produced_kg:920, target_quantity:720, due_date:"2026-08-22", sequence:2, status:"paused", notes:"Aguardando liberacao", source_data:{}, created_at:"2026-08-20", updated_at:"2026-08-21" },
  { id:"6", organization_id:"demo", import_batch_id:null, order_number:"126330015", plan_code:"P1800-02", machine_code:"P1800", tool_code:"TP-9902", product_code:"PF-04181", product_description:"Cantoneira 40 x 40", customer_name:"PERFILAR", alloy_code:"6063", temper:"T5", target_kg:760, produced_kg:0, target_quantity:540, due_date:"2026-08-23", sequence:1, status:"planned", notes:null, source_data:{}, created_at:"2026-08-21", updated_at:"2026-08-21" },
];

export const hourlyProduction = [
  { hora:"06h", produzido:380, meta:420 }, { hora:"08h", produzido:610, meta:630 },
  { hora:"10h", produzido:590, meta:630 }, { hora:"12h", produzido:440, meta:630 },
  { hora:"14h", produzido:670, meta:630 }, { hora:"16h", produzido:720, meta:630 },
  { hora:"18h", produzido:684, meta:630 },
];
