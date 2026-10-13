import { redirect } from "next/navigation";

// There is no public home page; middleware sends visitors to sign-in. This is a fallback.
export default function Home() {
  redirect("/login");
}
