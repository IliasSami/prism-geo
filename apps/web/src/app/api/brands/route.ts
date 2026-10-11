import { NextResponse } from "next/server";
import { getAllBrands, getActiveBrand, createBrand, setActiveBrand } from "@prismgeo/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const brands = getAllBrands();
    const activeBrand = getActiveBrand();
    return NextResponse.json({
      brands,
      activeBrandId: activeBrand?.id || brands[0]?.id || null,
      activeBrand,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, domain, description, aliases, valueProps, setActive } = body;

    if (!name || !domain) {
      return NextResponse.json({ error: "Brand name and domain are required" }, { status: 400 });
    }

    const brand = createBrand({
      name,
      domain,
      description,
      aliases: Array.isArray(aliases) ? aliases : [],
      valueProps: Array.isArray(valueProps) ? valueProps : [],
    });

    if (setActive !== false) {
      setActiveBrand(brand.id);
    }

    const response = NextResponse.json({ success: true, brand });
    if (setActive !== false) {
      response.cookies.set("prism_active_brand", brand.id, { path: "/", sameSite: "lax" });
    }
    return response;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
