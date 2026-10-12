import { execFileSync } from "node:child_process";

import type { Reporter, TestModule } from "vitest/node";

// Vitest's default reporter prints a file only when it finishes, so a file that
// never finishes leaves no line (docs/incidents/2026-10-09-vitest-shard-2-stall.md).
// "queued" prints right before vitest imports the setup file and the test file,
// "start" when its tests begin. The last "queued" with no matching "✓" in the
// log is the file that hung, even if it hung while importing.
//
// A shard that stalls after every file finished prints nothing at all, so a
// watchdog also prints what the vitest process is still holding and every live
// process once the run has been silent for STALL_AFTER_MS. A healthy gap
// between two files is about 10 seconds.
const STALL_AFTER_MS = 90_000;

function listProcesses(): string {
  try {
    return execFileSync("ps", ["-eo", "pid,ppid,etimes,stat,args", "--forest"], { encoding: "utf8" });
  } catch {
    return "ps unavailable";
  }
}

export class FileStartReporter implements Reporter {
  private watchdog: NodeJS.Timeout | undefined;
  private readonly unfinished = new Set<string>();

  private arm(): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      const held = process.getActiveResourcesInfo().join(",");
      const files = [...this.unfinished].join(" ") || "none";
      console.log(`[stalled] no file event for ${String(STALL_AFTER_MS / 1000)}s; unfinished files: ${files}`);
      console.log(`[stalled] vitest process holds: ${held}`);
      console.log(`[stalled] processes:\n${listProcesses()}`);
    }, STALL_AFTER_MS);
    this.watchdog.unref();
  }

  onTestModuleQueued(testModule: TestModule): void {
    this.unfinished.add(testModule.moduleId);
    this.arm();
    console.log(`[file-queued] ${testModule.project.name} ${testModule.moduleId}`);
  }

  onTestModuleStart(testModule: TestModule): void {
    this.arm();
    console.log(`[file-start] ${testModule.project.name} ${testModule.moduleId}`);
  }

  onTestModuleEnd(testModule: TestModule): void {
    this.unfinished.delete(testModule.moduleId);
    this.arm();
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    clearTimeout(this.watchdog);
    console.log(`[run-end] ${String(testModules.length)} files finished`);
  }
}
