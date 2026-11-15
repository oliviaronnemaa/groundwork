import { NextResponse } from "next/server";
import { hasClaude, MODEL } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ cala: !!process.env.CALA_API_KEY, exa: !!process.env.EXA_API_KEY, claude: hasClaude(), model: MODEL });
}
