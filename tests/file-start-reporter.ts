import type { Reporter, TestModule } from "vitest/node";

// Vitest's default reporter prints a file only when it finishes, so a file that
// never finishes leaves no line (docs/incidents/2026-10-09-vitest-shard-2-stall.md).
// "queued" prints right before vitest imports the setup file and the test file,
// "start" when its tests begin. The last "queued" with no matching "✓" in the
// log is the file that hung, even if it hung while importing.
export class FileStartReporter implements Reporter {
  onTestModuleQueued(testModule: TestModule): void {
    console.log(`[file-queued] ${testModule.project.name} ${testModule.moduleId}`);
  }

  onTestModuleStart(testModule: TestModule): void {
    console.log(`[file-start] ${testModule.project.name} ${testModule.moduleId}`);
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    console.log(`[run-end] ${String(testModules.length)} files finished`);
  }
}
