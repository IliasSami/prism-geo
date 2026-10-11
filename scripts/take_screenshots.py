import os
import sys
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = "/Users/sami/.gemini/antigravity/brain/7bfbc75c-2502-47cd-a7ff-b4932daef216"

PAGES = [
    {"url": "http://127.0.0.1:3333/", "filename": "prismgeo_outcraft_200_desktop_overview.png", "width": 1440, "height": 900},
    {"url": "http://127.0.0.1:3333/", "filename": "prismgeo_outcraft_200_mobile_overview.png", "width": 390, "height": 844},
    {"url": "http://127.0.0.1:3333/prompts", "filename": "prismgeo_outcraft_200_desktop_prompts.png", "width": 1440, "height": 1000},
    {"url": "http://127.0.0.1:3333/competitors", "filename": "prismgeo_outcraft_200_desktop_competitors.png", "width": 1440, "height": 1000},
    {"url": "http://127.0.0.1:3333/sov", "filename": "prismgeo_outcraft_200_desktop_sov.png", "width": 1440, "height": 1000},
    {"url": "http://127.0.0.1:3333/opportunities", "filename": "prismgeo_outcraft_200_desktop_opportunities.png", "width": 1440, "height": 900},
    {"url": "http://127.0.0.1:3333/engines", "filename": "prismgeo_outcraft_200_desktop_engines.png", "width": 1440, "height": 800},
]

def capture_all():
    print("📸 [PrismGEO Visual Auditor] Capturing visual snapshots for 200-prompt Outcraft AI campaign...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for page_info in PAGES:
            target_path = os.path.join(ARTIFACT_DIR, page_info["filename"])
            context = browser.new_context(viewport={"width": page_info["width"], "height": page_info["height"]})
            page = context.new_page()
            try:
                page.goto(page_info["url"], wait_until="networkidle", timeout=10000)
                page.wait_for_timeout(800)
                page.screenshot(path=target_path, full_page=False)
                print(f"  ✓ Captured: {page_info['filename']} ({page_info['width']}x{page_info['height']})")
            except Exception as e:
                print(f"  ✗ Failed {page_info['filename']}: {e}")
            finally:
                context.close()
        browser.close()
    print("✨ All visual snapshots saved successfully to artifacts directory!")

if __name__ == "__main__":
    capture_all()
