import { monthlyReport } from "@/server/reports";
import { reportFilename, wordReport } from "@/server/report-word";
import { reportFailure, reportHeaders } from "@/server/report-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { report } = await monthlyReport(new URL(request.url).searchParams, "admin", true);
    const file = await wordReport(report!);
    return new Response(new Uint8Array(file), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${reportFilename(report!)}"`,
      ...reportHeaders,
    } });
  } catch (error) { return reportFailure(error); }
}
