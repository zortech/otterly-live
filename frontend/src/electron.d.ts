interface OtteryElectronBridge {
  serverPort: number;
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  checkForUpdates(): Promise<void>;
  onOAuthCallback(callback: (url: string) => void): void;
  openLogFolder(): Promise<void>;
  onUpdateReady(callback: () => void): void;
  restartForUpdate(): void;
  onNavigate(callback: (route: string) => void): void;
}

declare interface Window {
  otteryElectron?: OtteryElectronBridge;
}
