import type { LogEntry, StructuredLogger } from "../src/core/logger.js";

export const silentLogger: StructuredLogger = {
  write() {},
};

export class MemoryLogger implements StructuredLogger {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}
