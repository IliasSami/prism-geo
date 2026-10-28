import { NextResponse } from "next/server";
import { getAllBrands, getActiveBrand, createBrand, setActiveBrand, getRawDb } from "@prismgeo/db";

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
    const sqlite = getRawDb();
    const existing = sqlite.prepare("SELECT id FROM brands WHERE domain = ? LIMIT 1").get(cleanDomain) as any;
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

/** Updates the profile of an existing client: name, domain, description and aliases. */
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof body.id !== "string") {
      return NextResponse.json({ error: "Brand id is required" }, { status: 400 });
    }
    const sqlite = getRawDb();
    const current = sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(body.id) as any;
    if (!current) return NextResponse.json({ error: `Brand ${body.id} not found` }, { status: 404 });

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
    const domain =
      typeof body.domain === "string" && body.domain.trim()
        ? body.domain.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "")
        : current.domain;
    if (!domain.includes(".")) {
      return NextResponse.json({ error: "Valid domain name is required (e.g., example.com)" }, { status: 400 });
    }
    if (sqlite.prepare("SELECT 1 FROM brands WHERE domain = ? AND id <> ?").get(domain, body.id)) {
      return NextResponse.json({ error: `Another client already uses the domain "${domain}"` }, { status: 409 });
    }
    // Aliases arrive as an array or as the comma-separated text of the settings form
    const rawAliases: unknown[] = Array.isArray(body.aliases)
      ? body.aliases
      : typeof body.aliases === "string"
        ? body.aliases.split(",")
        : JSON.parse(current.aliases_json || "[]");
    const aliases = [...new Set(rawAliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean))];
    const description = typeof body.description === "string" ? body.description.trim() || null : current.description;

    sqlite
      .prepare(
        "UPDATE brands SET name = ?, domain = ?, description = ?, aliases_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .run(name, domain, description, JSON.stringify(aliases), body.id);
    return NextResponse.json({ success: true, brand: sqlite.prepare("SELECT * FROM brands WHERE id = ?").get(body.id) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/**
 * Deletes a client and, through cascades, its prompts, competitors, audits and answers.
 * The active client cannot be deleted; switch to another one first.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.id !== "string") return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
    if (getActiveBrand()?.id === body.id) {
      return NextResponse.json({ error: "Switch to another client before deleting this one" }, { status: 409 });
    }
    const sqlite = getRawDb();
    if (sqlite.prepare("SELECT 1 FROM crawl_batches WHERE brand_id = ? AND status = 'running'").get(body.id)) {
      return NextResponse.json({ error: "An audit is running for this client" }, { status: 409 });
    }
    const res = sqlite.prepare("DELETE FROM brands WHERE id = ?").run(body.id);
    return res.changes ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Client not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
