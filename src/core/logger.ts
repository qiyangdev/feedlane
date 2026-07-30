export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: "request.started" | "request.completed";
  service: "feedlane";
  requestId: string;
  method: string;
  path?: string;
  vercelRequestId?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
}

export interface StructuredLogger {
  write(entry: LogEntry): void;
}

export const jsonConsoleLogger: StructuredLogger = {
  write(entry) {
    const line = JSON.stringify(entry);
    if (entry.level === "error") {
      console.error(line);
      return;
    }
    if (entry.level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  },
};
