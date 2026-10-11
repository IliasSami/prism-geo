import { NextResponse } from "next/server";
import { setActiveBrand, db, schema, eq } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { brandId } = await request.json();
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }

    const brand = await db.query.brands.findFirst({
      where: eq(schema.brands.id, brandId),
    });

    if (!brand) {
      return NextResponse.json({ error: `Brand ${brandId} not found` }, { status: 404 });
    }

    setActiveBrand(brandId);

    const response = NextResponse.json({ success: true, activeBrand: brand });
    response.cookies.set("prism_active_brand", brandId, { path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
