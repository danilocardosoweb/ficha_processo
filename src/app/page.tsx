import { redirect } from "next/navigation";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

export default function Home() {
  redirect(isLocalDesktopMode() ? "/local" : "/dashboard");
}
