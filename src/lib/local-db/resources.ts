import "server-only";

import { randomUUID } from "node:crypto";
import { appendLocalAuditEvent, getLocalDatabase } from "@/lib/local-db/database";

type ResourceStatus = "available" | "maintenance" | "blocked" | "inactive";
type BilletStatus = "available" | "blocked" | "depleted";

function now() {
  return new Date().toISOString();
}

function number(value: unknown) {
  return Number(value ?? 0);
}

function reservedBars(connection: ReturnType<typeof getLocalDatabase>, lotId: string) {
  const result = connection.prepare(`
    select coalesce(sum(reserved_bars - consumed_bars), 0) as reserved_bars
    from local_billet_reservations where stock_lot_id = ? and status = 'active'
  `).get(lotId) as { reserved_bars: number };
  return number(result.reserved_bars);
}

export function listLocalBilletStock() {
  const connection = getLocalDatabase();
  const rows = connection.prepare(`
    select l.*,
      coalesce((select sum(r.reserved_bars - r.consumed_bars) from local_billet_reservations r
        where r.stock_lot_id = l.id and r.status = 'active'), 0) as reserved_bars
    from local_billet_stock_lots l
    order by upper(l.alloy_code), l.received_at, l.lot_code collate nocase
  `).all() as Array<Record<string, unknown>>;
  const lots = rows.map((row) => {
    const reserved = number(row.reserved_bars);
    return {
      id: String(row.id),
      alloyCode: String(row.alloy_code),
      lotCode: String(row.lot_code),
      barWeightKg: number(row.bar_weight_kg),
      totalBars: number(row.total_bars),
      reservedBars: reserved,
      availableBars: Math.max(number(row.total_bars) - reserved, 0),
      status: String(row.status) as BilletStatus,
      location: String(row.location ?? ""),
      receivedAt: String(row.received_at),
      notes: String(row.notes ?? ""),
      updatedAt: String(row.updated_at),
    };
  });
  const grouped = new Map<string, {
    alloyCode: string; lotCount: number; totalBars: number; reservedBars: number;
    availableBars: number; totalWeightKg: number; availableWeightKg: number;
  }>();
  for (const lot of lots) {
    const summary = grouped.get(lot.alloyCode.toUpperCase()) ?? {
      alloyCode: lot.alloyCode.toUpperCase(), lotCount: 0, totalBars: 0, reservedBars: 0,
      availableBars: 0, totalWeightKg: 0, availableWeightKg: 0,
    };
    summary.lotCount += 1;
    summary.totalBars += lot.totalBars;
    summary.reservedBars += lot.reservedBars;
    if (lot.status === "available") {
      summary.availableBars += lot.availableBars;
      summary.availableWeightKg += lot.availableBars * number(lot.barWeightKg);
    }
    summary.totalWeightKg += lot.totalBars * number(lot.barWeightKg);
    grouped.set(lot.alloyCode.toUpperCase(), summary);
  }
  return { lots, summary: [...grouped.values()].sort((a, b) => a.alloyCode.localeCompare(b.alloyCode)) };
}

export function saveLocalBilletLot(input: {
  id: string | null; alloyCode: string; lotCode: string; barWeightKg: number; totalBars: number;
  status: BilletStatus; location: string; receivedAt: string; notes: string;
}, actorUserId: string) {
  const connection = getLocalDatabase();
  const id = input.id ?? randomUUID();
  const timestamp = now();
  const existing = connection.prepare("select id from local_billet_stock_lots where id = ?").get(id);
  const currentReserved = existing ? reservedBars(connection, id) : 0;
  if (input.totalBars < currentReserved) throw new Error(`O total não pode ficar abaixo das ${currentReserved} barras reservadas.`);
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`update local_billet_stock_lots set alloy_code = ?, lot_code = ?, bar_weight_kg = ?, total_bars = ?,
        status = ?, location = ?, received_at = ?, notes = ?, updated_at = ? where id = ?`)
        .run(input.alloyCode, input.lotCode, input.barWeightKg, input.totalBars, input.status, input.location, input.receivedAt, input.notes, timestamp, id);
    } else {
      connection.prepare(`insert into local_billet_stock_lots(id, alloy_code, lot_code, bar_weight_kg, total_bars, status, location, received_at, notes, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.alloyCode, input.lotCode, input.barWeightKg, input.totalBars, input.status, input.location, input.receivedAt, input.notes, timestamp, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "billet_lot", entityId: id, eventType: existing ? "billet_lot_updated" : "billet_lot_created", details: { alloy_code: input.alloyCode, lot_code: input.lotCode, total_bars: input.totalBars, status: input.status } });
  })();
  return id;
}

export function reserveLocalBilletStock(input: {
  alloyCode: string; bars: number; simulationVersionId: string | null; productionOrderId: string | null; notes: string;
}, actorUserId: string) {
  const connection = getLocalDatabase();
  const reserve = connection.transaction(() => {
    const lots = connection.prepare(`
      select l.id, l.lot_code, l.total_bars,
        coalesce(sum(case when r.status = 'active' then r.reserved_bars - r.consumed_bars else 0 end), 0) as reserved_bars
      from local_billet_stock_lots l
      left join local_billet_reservations r on r.stock_lot_id = l.id
      where upper(trim(l.alloy_code)) = upper(trim(?)) and l.status = 'available'
      group by l.id order by l.received_at, l.created_at, l.lot_code collate nocase
    `).all(input.alloyCode) as Array<{ id: string; lot_code: string; total_bars: number; reserved_bars: number }>;
    const available = lots.reduce((sum, lot) => sum + Math.max(number(lot.total_bars) - number(lot.reserved_bars), 0), 0);
    if (available < input.bars) throw new Error(`Estoque insuficiente: ${available} barra(s) disponível(is) para ${input.bars} solicitada(s).`);
    let remaining = input.bars;
    const allocations: Array<{ reservationId: string; lotId: string; lotCode: string; bars: number }> = [];
    const timestamp = now();
    for (const lot of lots) {
      if (remaining <= 0) break;
      const free = Math.max(number(lot.total_bars) - number(lot.reserved_bars), 0);
      const take = Math.min(remaining, free);
      if (!take) continue;
      const reservationId = randomUUID();
      connection.prepare(`insert into local_billet_reservations(id, stock_lot_id, simulation_version_id, production_order_id,
        reserved_bars, consumed_bars, status, notes, created_by, created_at, updated_at)
        values (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?)`)
        .run(reservationId, lot.id, input.simulationVersionId, input.productionOrderId, take, input.notes, actorUserId, timestamp, timestamp);
      allocations.push({ reservationId, lotId: lot.id, lotCode: lot.lot_code, bars: take });
      remaining -= take;
    }
    if (remaining > 0) throw new Error("O estoque mudou durante a reserva. Atualize a tela e tente novamente.");
    appendLocalAuditEvent({ actorUserId, entityType: "billet_reservation", eventType: "billet_stock_reserved", details: { alloy_code: input.alloyCode.toUpperCase(), bars: input.bars, allocations } });
    return { alloyCode: input.alloyCode.trim().toUpperCase(), bars: input.bars, allocations };
  });
  return reserve.immediate();
}

export function releaseLocalBilletReservation(reservationId: string, actorUserId: string) {
  const connection = getLocalDatabase();
  const result = connection.transaction(() => {
    const reservation = connection.prepare(`select id, stock_lot_id, reserved_bars, status from local_billet_reservations where id = ?`).get(reservationId) as { id: string; stock_lot_id: string; reserved_bars: number; status: string } | undefined;
    if (!reservation || reservation.status !== "active") return false;
    connection.prepare("update local_billet_reservations set status = 'released', updated_at = ? where id = ? and status = 'active'").run(now(), reservationId);
    appendLocalAuditEvent({ actorUserId, entityType: "billet_reservation", entityId: reservationId, eventType: "billet_reservation_released", details: { stock_lot_id: reservation.stock_lot_id, reserved_bars: reservation.reserved_bars } });
    return true;
  });
  return result.immediate();
}

export function listLocalBoResources() {
  return (getLocalDatabase().prepare(`select * from local_bo_resources order by bo_code collate nocase`).all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), boCode: String(row.bo_code), totalQuantity: number(row.total_quantity), unavailableQuantity: number(row.unavailable_quantity),
    availableQuantity: row.status === "available" ? Math.max(number(row.total_quantity) - number(row.unavailable_quantity), 0) : 0,
    status: String(row.status) as ResourceStatus, location: String(row.location ?? ""), notes: String(row.notes ?? ""),
  }));
}

export function saveLocalBoResource(input: {
  id: string | null; boCode: string; totalQuantity: number; unavailableQuantity: number; status: ResourceStatus; location: string; notes: string;
}, actorUserId: string, actorName: string) {
  const connection = getLocalDatabase();
  const id = input.id ?? randomUUID();
  const timestamp = now();
  const existing = connection.prepare("select id from local_bo_resources where id = ?").get(id);
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`update local_bo_resources set bo_code = ?, total_quantity = ?, unavailable_quantity = ?, status = ?, location = ?, notes = ?, updated_by_user_id = ?, updated_by_name = ?, updated_at = ? where id = ?`)
        .run(input.boCode, input.totalQuantity, input.unavailableQuantity, input.status, input.location, input.notes, actorUserId, actorName, timestamp, id);
    } else {
      connection.prepare(`insert into local_bo_resources(id, bo_code, total_quantity, unavailable_quantity, status, location, notes, updated_by_user_id, updated_by_name, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.boCode, input.totalQuantity, input.unavailableQuantity, input.status, input.location, input.notes, actorUserId, actorName, timestamp, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "bo_resource", entityId: id, eventType: existing ? "bo_resource_updated" : "bo_resource_created", details: { bo_code: input.boCode, total_quantity: input.totalQuantity, unavailable_quantity: input.unavailableQuantity, status: input.status } });
  })();
  return id;
}

export function listLocalCarcassResources() {
  return (getLocalDatabase().prepare(`select * from local_press_carcass_resources order by carcass_code collate nocase`).all() as Array<Record<string, unknown>>).map((row) => {
    const total = number(row.total_quantity);
    const unavailable = number(row.unavailable_quantity);
    const reserved = 0;
    return {
      id: String(row.id), machineCode: "SHARED", sharedAcrossMachines: true, carcassCode: String(row.carcass_code),
      totalQuantity: total, unavailableQuantity: unavailable, reservedQuantity: reserved,
      availableQuantity: row.status === "available" ? Math.max(total - unavailable - reserved, 0) : 0,
      status: String(row.status) as ResourceStatus, location: String(row.location ?? ""), notes: String(row.notes ?? ""), updatedAt: String(row.updated_at),
    };
  });
}

export function saveLocalCarcassResource(input: {
  id: string | null; machineCode: string; carcassCode: string; totalQuantity: number; unavailableQuantity: number;
  status: ResourceStatus; location: string; notes: string;
}, actorUserId: string, actorName: string) {
  const connection = getLocalDatabase();
  const id = input.id ?? randomUUID();
  const timestamp = now();
  const existing = connection.prepare("select id from local_press_carcass_resources where id = ?").get(id);
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`update local_press_carcass_resources set machine_code = 'SHARED', carcass_code = ?, total_quantity = ?, unavailable_quantity = ?, status = ?, location = ?, notes = ?, updated_by_user_id = ?, updated_by_name = ?, updated_at = ? where id = ?`)
        .run(input.carcassCode, input.totalQuantity, input.unavailableQuantity, input.status, input.location, input.notes, actorUserId, actorName, timestamp, id);
    } else {
      connection.prepare(`insert into local_press_carcass_resources(id, machine_code, carcass_code, total_quantity, unavailable_quantity, status, location, notes, updated_by_user_id, updated_by_name, created_at, updated_at)
        values (?, 'SHARED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.carcassCode, input.totalQuantity, input.unavailableQuantity, input.status, input.location, input.notes, actorUserId, actorName, timestamp, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "carcass_resource", entityId: id, eventType: existing ? "carcass_resource_updated" : "carcass_resource_created", details: { carcass_code: input.carcassCode, total_quantity: input.totalQuantity, unavailable_quantity: input.unavailableQuantity, status: input.status, shared: true } });
  })();
  return id;
}

export function listLocalToolCarcassRequirements() {
  const connection = getLocalDatabase();
  const mappings = (connection.prepare(`select * from local_tool_carcass_requirements order by tool_code collate nocase, machine_code collate nocase, sequence_number`).all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), toolCode: String(row.tool_code), machineCode: row.machine_code === null ? null : String(row.machine_code),
    sequenceNumber: row.sequence_number === null ? null : number(row.sequence_number), carcassCode: String(row.carcass_code),
    quantity: number(row.quantity), notes: String(row.notes ?? ""), isActive: Boolean(row.is_active),
    updatedBy: row.updated_by_name === null ? null : String(row.updated_by_name), updatedAt: String(row.updated_at),
  }));
  const tools = connection.prepare(`select code, description from local_tools order by code collate nocase`).all() as Array<{ code: string; description: string | null }>;
  const machines = connection.prepare(`select code, name from local_machines where is_active = 1 order by code collate nocase`).all() as Array<{ code: string; name: string }>;
  const carcasses = listLocalCarcassResources().map((item) => ({ code: item.carcassCode, availableQuantity: item.availableQuantity }));
  return { mappings, tools, carcasses, machines };
}

export function saveLocalToolCarcassRequirement(input: {
  id: string | null; toolCode: string; machineCode: string | null; sequenceNumber: number | null;
  carcassCode: string; quantity: number; notes: string; isActive: boolean;
}, actorUserId: string, actorName: string) {
  const connection = getLocalDatabase();
  const tool = connection.prepare("select code from local_tools where code = ?").get(input.toolCode) as { code: string } | undefined;
  if (!tool) throw new Error("Cadastre ou importe a ferramenta antes de vincular a carcaça.");
  const carcass = connection.prepare("select carcass_code from local_press_carcass_resources where carcass_code = ?").get(input.carcassCode);
  if (!carcass) throw new Error("Cadastre a carcaça física antes de vinculá-la à ferramenta.");
  if (input.machineCode) {
    const machine = connection.prepare("select code from local_machines where code = ? and is_active = 1").get(input.machineCode);
    if (!machine) throw new Error("Prensa não encontrada ou inativa.");
  }
  const tupleExisting = connection.prepare(`select id from local_tool_carcass_requirements
    where tool_code = ? and coalesce(machine_code, '') = coalesce(?, '') and coalesce(sequence_number, -1) = coalesce(?, -1)`)
    .get(tool.code, input.machineCode, input.sequenceNumber) as { id: string } | undefined;
  const requested = input.id ? connection.prepare("select id from local_tool_carcass_requirements where id = ?").get(input.id) as { id: string } | undefined : undefined;
  const id = requested?.id ?? tupleExisting?.id ?? input.id ?? randomUUID();
  const existing = Boolean(requested || tupleExisting);
  const timestamp = now();
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`update local_tool_carcass_requirements set tool_code = ?, machine_code = ?, sequence_number = ?, carcass_code = ?, quantity = ?, notes = ?, is_active = ?, updated_by_user_id = ?, updated_by_name = ?, updated_at = ? where id = ?`)
        .run(tool.code, input.machineCode, input.sequenceNumber, input.carcassCode, input.quantity, input.notes, input.isActive ? 1 : 0, actorUserId, actorName, timestamp, id);
    } else {
      connection.prepare(`insert into local_tool_carcass_requirements(id, tool_code, machine_code, sequence_number, carcass_code, quantity, notes, is_active, updated_by_user_id, updated_by_name, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, tool.code, input.machineCode, input.sequenceNumber, input.carcassCode, input.quantity, input.notes, input.isActive ? 1 : 0, actorUserId, actorName, timestamp, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "tool_carcass_requirement", entityId: id, eventType: existing ? "tool_carcass_requirement_updated" : "tool_carcass_requirement_created", details: { tool_code: tool.code, machine_code: input.machineCode, sequence_number: input.sequenceNumber, carcass_code: input.carcassCode, quantity: input.quantity, is_active: input.isActive } });
  })();
  return id;
}
