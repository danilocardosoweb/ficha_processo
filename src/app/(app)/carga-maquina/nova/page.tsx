import { redirect } from "next/navigation";

export default function DeprecatedMachineLoadV2Page() {
  redirect("/carga-maquina/v3");
}
