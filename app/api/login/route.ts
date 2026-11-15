import { NextResponse } from "next/server";
import { passHash } from "@/middleware";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pw = process.env.SITE_PASSWORD;
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const back = new URL("/", req.url);
  if (!pw) return NextResponse.redirect(back, 303);
  if (given !== pw) return NextResponse.redirect(new URL("/login?wrong=1", req.url), 303);
  const res = NextResponse.redirect(back, 303);
  res.cookies.set("gw_pass", await passHash(pw), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
