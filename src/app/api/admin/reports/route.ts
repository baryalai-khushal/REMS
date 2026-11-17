import { monthlyReport } from "@/server/reports";
import { reportFailure, reportHeaders } from "@/server/report-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json(await monthlyReport(new URL(request.url).searchParams, "admin"), { headers: reportHeaders }); }
  catch (error) { return reportFailure(error); }
}
