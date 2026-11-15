import { NextResponse, type NextRequest } from "next/server";

// One shared password in front of the whole site when SITE_PASSWORD is set (on Vercel).
// Locally it's unset, so nothing changes. The cookie holds a hash, never the password.

export async function passHash(pw: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("groundwork:" + pw));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return NextResponse.next();
  if (req.cookies.get("gw_pass")?.value === (await passHash(pw))) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Password required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|_next/|favicon).*)"],
};
