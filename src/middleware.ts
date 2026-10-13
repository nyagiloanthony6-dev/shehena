import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Keeps the Supabase session fresh and keeps signed-out visitors out of /app. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith("/app") || path.startsWith("/owner"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }
  // Remember which salesperson's link brought this visitor, so a self sign-up is credited to them.
  const ref = request.nextUrl.searchParams.get("ref");
  const keepRef = (r: NextResponse) => {
    if (ref && /^[a-z0-9_-]{2,40}$/i.test(ref)) r.cookies.set("shehena_ref", ref.toLowerCase(), { maxAge: 60 * 60 * 24 * 60, sameSite: "lax", path: "/" });
    return r;
  };
  // No public home page: the address goes straight to sign-in (or into the app when signed in).
  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/app" : "/login";
    url.search = "";
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return keepRef(r);
  }
  return keepRef(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
