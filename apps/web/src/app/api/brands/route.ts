import { NextResponse } from "next/server";
import { getAllBrands, getActiveBrand, createBrand, setActiveBrand, db } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const brands = getAllBrands();
    let activeBrand = getActiveBrand();
    if (!activeBrand && brands.length > 0) {
      activeBrand = brands[0];
    }
    return NextResponse.json({
      brands,
      activeBrandId: activeBrand?.id || null,
      activeBrand: activeBrand || null,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }

    const { name, domain, description, aliases, valueProps, setActive } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
    }
    if (!domain || typeof domain !== "string" || !domain.trim()) {
      return NextResponse.json({ error: "Brand domain is required" }, { status: 400 });
    }

    const cleanDomain = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");

    if (!cleanDomain || !cleanDomain.includes(".")) {
      return NextResponse.json({ error: "Valid domain name is required (e.g., example.com)" }, { status: 400 });
    }

    const cleanName = name.trim();

    // Check duplicate domain
    const existing = await db.query.brands.findFirst({
      where: { domain: cleanDomain },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Brand with domain "${cleanDomain}" already exists` },
        { status: 409 }
      );
    }

    const cleanAliases = Array.isArray(aliases)
      ? aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
      : [];

    const cleanValueProps = Array.isArray(valueProps)
      ? valueProps.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
      : [];

    const brand = createBrand({
      name: cleanName,
      domain: cleanDomain,
      description: typeof description === "string" ? description.trim() : undefined,
      aliases: cleanAliases,
      valueProps: cleanValueProps,
    });

    if (setActive !== false) {
      setActiveBrand(brand.id);
    }

    const response = NextResponse.json({ success: true, brand });
    if (setActive !== false) {
      response.cookies.set("prism_active_brand", brand.id, {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }
    return response;
  } catch (error) {
    const msg = (error as Error).message || "Internal server error";
    const status = msg.includes("UNIQUE constraint failed") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
