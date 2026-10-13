/** Bridge exposed by the Electron preload script; absent when the app runs in a plain browser. */
export type DesktopBridge = { pickFolder(): Promise<string | null>; openExternal(url: string): void };

declare global {
  interface Window {
    rdi?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | null => window.rdi ?? null;
