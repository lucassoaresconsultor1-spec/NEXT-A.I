import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth/session";

export default async function Home() {
  redirect((await getCurrentSession()) ? "/painel" : "/entrar");
}
