import type { ScheduledLoadItem } from "../machine-load-simulator";
import { lateMinutes } from "./dates";
export function overviewFlags(item: ScheduledLoadItem) {
  return { blocked:item.resourceConflicts.some(c=>c.severity==="blocking"),
    late:lateMinutes(item.dueDate,item.endAt)>0, thermal:item.thermalWaitMinutes>0 };
}
export function intervalOnWindow(start:number,end:number,from:number,to:number) {
  if(to<=from || end<=from || start>=to || end<=start) return null;
  return {left:100*(Math.max(start,from)-from)/(to-from),width:100*(Math.min(end,to)-Math.max(start,from))/(to-from)};
}
export function resourceHotspots(items:ScheduledLoadItem[]) {
  const groups=new Map<string,Set<string>>();
  for(const item of items) for(const conflict of item.resourceConflicts.filter(c=>c.severity==="blocking")) {
    const key=conflict.resourceCode;
    if(!groups.has(key)) groups.set(key,new Set());
    groups.get(key)!.add(item.id);
  }
  return [...groups].map(([resource,ids])=>({resource,ids:[...ids]})).sort((a,b)=>b.ids.length-a.ids.length);
}
