import fs from "node:fs";
import path from "node:path";

export interface StealthProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  timezoneId: string;
}

/**
 * Desktop Chrome user agent for the given browser version. The UA must match the real engine
 * version: a Chrome/134 UA on a Chrome/156 engine is an easy bot signal.
 */
export function desktopUserAgent(browserVersion?: string): string {
  const major = (browserVersion || "").split(".")[0] || "141";
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const VIEWPORTS = [
  { width: 1440, height: 900, deviceScaleFactor: 2 },
  { width: 1920, height: 1080, deviceScaleFactor: 1 },
  { width: 1680, height: 1050, deviceScaleFactor: 2 },
  { width: 1536, height: 864, deviceScaleFactor: 1.25 },
];

export function generateStealthProfile(browserVersion?: string): StealthProfile {
  const ua = desktopUserAgent(browserVersion);
  const vp = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

  return {
    userAgent: ua,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    locale: "en-US",
    // The machine's own zone: a timezone that disagrees with the IP's location is a bot signal
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export function getChromiumExecutablePath(): string | undefined {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const standardChromeMac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(standardChromeMac)) {
    return standardChromeMac;
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) {
    const candidateHeadless = path.join(
      home,
      "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    );
    if (fs.existsSync(candidateHeadless)) {
      return candidateHeadless;
    }
    const candidateMacPath = path.join(
      home,
      "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    );
    if (fs.existsSync(candidateMacPath)) {
      return candidateMacPath;
    }
  }
  return undefined;
}

export const STEALTH_INJECTION_SCRIPT = `
(() => {
  // 0. Ensure __name is defined in browser context for tsx/esbuild evaluated functions
  try {
    var fn = (target, value) => target;
    window.__name = fn;
    globalThis.__name = fn;
  } catch (e) {}

  // 1. Delete navigator.webdriver prototype cleanly
  try {
    delete Object.getPrototypeOf(navigator).webdriver;
  } catch (e) {}

  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: () => false,
    configurable: true,
  });

  // 2. Mock authentic Chrome runtime
  window.chrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      id: undefined,
    },
    loadTimes: () => ({
      connectionInfo: 'http/1.1',
      finishDocumentLoadTime: 1.2,
      finishLoadTime: 1.5,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: 0.8,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'unknown',
      requestTime: 0.1,
      startLoadTime: 0.2,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: false,
    }),
  };

  // 3. Spoof authentic PluginArray with standard PDF viewers (cached for referential equality)
  const mockPlugins = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
  ];
  const pluginArrayInstance = Object.create(PluginArray.prototype);
  Object.assign(pluginArrayInstance, mockPlugins);
  Object.defineProperty(pluginArrayInstance, 'length', { value: mockPlugins.length });
  pluginArrayInstance.item = (i) => mockPlugins[i];
  pluginArrayInstance.namedItem = (name) => mockPlugins.find(p => p.name === name);

  Object.defineProperty(navigator, 'plugins', {
    get: () => pluginArrayInstance,
    configurable: true,
  });

  // 4. Clean languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });

  // 5. Spoof WebGL vendor and renderer (M3 / ANGLE)
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 37445) return 'Google Inc. (Apple)';
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Version 18.0)';
    return getParameter.call(this, parameter);
  };

  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) return 'Google Inc. (Apple)';
      // UNMASKED_RENDERER_WEBGL
      if (parameter === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Version 18.0)';
      return getParameter2.call(this, parameter);
    };
  }
})();
`;
