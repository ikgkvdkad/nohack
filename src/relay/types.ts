export type RelayState = 'selecting' | 'connecting' | 'connected' | 'disconnected';

export interface LogEntry {
  time: string;
  message: string;
  highlight?: boolean;
}

export interface DeviceInfo {
  address: string;
  name: string;
  displayName: string;
  lastUsed: boolean;
}
