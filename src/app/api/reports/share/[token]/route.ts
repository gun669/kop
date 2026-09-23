import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { computePnl } from "@/lib/reports";
import { renderPnlPdf } from "@/lib/reportPdf";

export const dynamic = "force-dynamic";

// Public, token-gated — no session cookie, same pattern as /book and the
// other guarded routes documented in the build log (operational note #2):
// the random token in the URL is what stands in for a login here, and a
// revoked link 404s immediately rather than ever rendering data again.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const [link] = await db
    .select()
    .from(schema.reportShareLinks)
    .where(eq(schema.reportShareLinks.token, token))
    .limit(1);

  if (!link || link.revoked) {
    return new Response("This report link is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.id, link.studioId))
    .limit(1);

  if (!studio) {
    return new Response("Not found", { status: 404 });
  }

  const pnl = await computePnl(link.studioId, link.periodFrom, link.periodTo);

  const pdfBuffer = renderPnlPdf({
    studioName: studio.name,
    currency: studio.currency,
    from: link.periodFrom,
    to: link.periodTo,
    pnl,
  });

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${studio.slug}-report-${link.periodFrom}-to-${link.periodTo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
