import { NextResponse } from "next/server";
import { setActiveBrand, db, schema, eq } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    const { brandId } = body;
    if (!brandId || typeof brandId !== "string" || !brandId.trim()) {
      return NextResponse.json({ error: "Valid brandId is required" }, { status: 400 });
    }

    const cleanBrandId = brandId.trim();

    const brand = await db.query.brands.findFirst({
      where: eq(schema.brands.id, cleanBrandId),
    });

    if (!brand) {
      return NextResponse.json({ error: `Brand ${cleanBrandId} not found` }, { status: 404 });
    }

    setActiveBrand(cleanBrandId);

    const response = NextResponse.json({ success: true, activeBrand: brand });
    response.cookies.set("prism_active_brand", cleanBrandId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
