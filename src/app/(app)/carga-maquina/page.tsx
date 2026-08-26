import { MachineLoadSimulator } from "@/components/machine-load-simulator";
import { PageHeading } from "@/components/page-heading";

export default function MachineLoadPage() {
  return <><PageHeading eyebrow="PCP · Simulação operacional" title="Carga Máquina" description="Preveja o término da programação cruzando produtividade, prensa, aquecimento das ferramentas e carga de tarugos por liga." /><MachineLoadSimulator /></>;
}
