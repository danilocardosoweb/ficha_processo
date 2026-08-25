import type { OrderStatus } from "@/types/database";
import { cn } from "@/lib/utils";
const labels: Record<OrderStatus,string> = { planned:"Planejada", released:"Liberada", in_progress:"Em producao", paused:"Pausada", completed:"Concluida", cancelled:"Cancelada" };
const colors: Record<OrderStatus,string> = { planned:"bg-slate-100 text-slate-600", released:"bg-blue-50 text-blue-700", in_progress:"bg-orange-50 text-orange-700", paused:"bg-amber-50 text-amber-700", completed:"bg-emerald-50 text-emerald-700", cancelled:"bg-red-50 text-red-700" };
export function StatusBadge({ status }: { status: OrderStatus }) { return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", colors[status])}><span className="size-1.5 rounded-full bg-current" />{labels[status]}</span>; }
