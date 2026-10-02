import type { LoadOrderInput } from "../machine-load-simulator";
export function movePlannedOrder(orders: LoadOrderInput[], id: string, position: number, reason: string) {
  if (reason.trim().length < 10) throw new Error("Explique o motivo da troca com pelo menos 10 caracteres.");
  const selected = orders.find(order => order.id === id);
  if (!selected) throw new Error("A ordem não está mais na carga. Atualize a tela.");
  const group = orders.filter(order => order.machineCode === selected.machineCode).sort((a,b)=>a.sequence-b.sequence);
  const from = group.findIndex(order=>order.id===id);
  if (!Number.isInteger(position) || position < 1 || position > group.length) throw new Error("Escolha uma posição válida.");
  if (position === from + 1) throw new Error("Escolha uma posição diferente da atual.");
  const locked = (order: LoadOrderInput) => order.status === "in_progress" || order.status === "paused";
  if (group.slice(Math.min(from,position-1),Math.max(from,position-1)+1).some(locked))
    throw new Error("Não é possível mover ou ultrapassar uma ordem já iniciada.");
  const [item] = group.splice(from,1);
  group.splice(position-1,0,item);
  const positions = new Map(group.map((order,index)=>[order.id,index+1]));
  return {
    orders: orders.map(order=>({...order,sequence:positions.get(order.id) ?? order.sequence})),
    change: { orderId:id, toolCode:selected.toolCode, machineCode:selected.machineCode,
      from:from+1, to:position, reason:reason.trim(), recordedAt:new Date().toISOString() },
  };
}
