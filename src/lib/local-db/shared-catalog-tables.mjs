// Apenas tabelas operacionais que podem ser consultadas pelas oito estações.
// Credenciais, sessões, auditoria privada e arquivo bruto da web ficam fora.
export const sharedCatalogTables = Object.freeze([
  "local_machines",
  "local_tools",
  "local_process_sheets",
  "local_billet_stock_lots",
  "local_bo_resources",
  "local_press_carcass_resources",
  "local_tool_carcass_requirements",
  "local_portfolio_snapshots",
  "local_simplified_imports",
  "local_simplified_baseline_orders",
]);
