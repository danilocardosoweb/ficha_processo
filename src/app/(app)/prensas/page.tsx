import { MachineManager } from "@/components/machine-manager";
import { PageHeading } from "@/components/page-heading";

export default function PressesPage() {
  return <><PageHeading eyebrow="Cadastros" title="Prensas" description="Cadastre as prensas usadas no planejamento e no chao de fabrica." /><MachineManager /></>;
}
