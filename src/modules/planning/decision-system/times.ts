import { workingMinutesBetween, type LoadSimulation, type WorkShiftInput, type ResourceUnavailabilityInput, type OvertimePeriodInput } from "../machine-load-simulator";
export function operationalTimes(simulation: LoadSimulation, start: Date, shifts: WorkShiftInput[], unavailable: ResourceUnavailabilityInput[], overtimePeriods: OvertimePeriodInput[] = []) {
  return simulation.machines.map(machine => {
    const end = machine.endsAt ?? start;
    // Cada prensa começa a ser medida quando sua primeira ferramenta pode
    // entrar na programação. O início global do cenário não deve virar tempo
    // fora de turno de uma prensa que ainda não tinha trabalho.
    const machineStart = machine.items[0]?.pressReadyAt ?? machine.startsAt ?? start;
    const calendar = Math.max(0, (end.getTime() - machineStart.getTime()) / 60000);
    const inShift = workingMinutesBetween(machineStart, end, shifts, machine.machineCode);
    const available = workingMinutesBetween(machineStart, end, shifts, machine.machineCode, unavailable, overtimePeriods);
    const overtime = workingMinutesBetween(machineStart, end, [], machine.machineCode, unavailable, overtimePeriods);
    return { machineCode: machine.machineCode,
      productive: machine.theoreticalMinutes,
      initialPreparation: machine.items.reduce((sum, item) => sum + item.initialPreparationMinutes, 0),
      toolChanges: machine.items.reduce((sum, item) => sum + item.toolChangeMinutes, 0),
      alloyChanges: machine.items.reduce((sum, item) => sum + item.alloyChangeMinutes, 0),
      thermal: machine.items.reduce((sum, item) => sum + item.thermalWaitMinutes, 0),
      resource: machine.items.reduce((sum, item) => sum + item.resourceWaitMinutes, 0),
      overtime, scheduledStop: Math.max(0, inShift + overtime - available), outsideCalendar: Math.max(0, calendar - inShift - overtime),
      calendar, end, startsAt: machineStart,
    };
  });
}
