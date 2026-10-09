import type { Reporter, TestModule } from "vitest/node";

// Vitest's default reporter prints a file only when it finishes, so a file that
// never finishes leaves no line (docs/incidents/2026-10-09-vitest-shard-2-stall.md).
// This prints one line when each file starts; the last "start" with no
// matching "✓" in the log is the hung file.
export class FileStartReporter implements Reporter {
  onTestModuleStart(testModule: TestModule): void {
    console.log(`[file-start] ${testModule.project.name} ${testModule.moduleId}`);
  }
}
