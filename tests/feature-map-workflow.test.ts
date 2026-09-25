import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../.github/workflows/feature-map.yml'),
  'utf8'
);

const job = (name: string): string => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `job ${name} is missing`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n')
};

describe('feature-map workflow duplicate guard (0509#5252)', () => {
  it('sync PRs use the fixed feature-map-sync head branch, force-pushed', () => {
    const sync = job('sync');
    // The regression is a per-SHA head (`feature-map-sync-<sha>`); a plain
    // toContain would be satisfied by that string as a prefix, so every
    // assertion below refuses a trailing `-`/word character.
    expect(sync).not.toMatch(/feature-map-sync-(?!$)/m);
    expect(sync).toMatch(/--head feature-map-sync(?![-\w])/);
    expect(sync).toMatch(/git push --force origin feature-map-sync(?![-\w])/);
    expect(sync).not.toContain('${{ env.SHA }}` from the commit');
  });

  it('the guard job reports whether an open sync PR exists', () => {
    const guard = job('guard');
    expect(guard).toContain('sync_pr_open: ${{ steps.check.outputs.sync_pr_open }}');
    expect(guard).toContain('startswith("feature-map: sync with")');
    expect(guard).toContain('pull-requests: read');
  });

  it('dispatch and sync both wait on the guard and skip while one is open', () => {
    expect(job('dispatch')).toContain(
      "if: github.event_name == 'push' && needs.guard.outputs.sync_pr_open == '0'"
    );
    expect(job('sync')).toContain(
      "if: github.event_name == 'workflow_dispatch' && needs.guard.outputs.sync_pr_open == '0'"
    );
  });

  it('a sync PR is armed for auto-merge as soon as it is opened', () => {
    const sync = job('sync');
    expect(sync).toContain('name: Arm auto-merge on the sync pull request');
    expect(sync).toMatch(/kind == 'opened-pr'/);
    expect(sync).toContain('GH_TOKEN: ${{ steps.app.outputs.token }}');
    expect(sync).toMatch(/run: gh pr merge "\$PR" --auto --squash/);
  });

  it('runs are serialised so a dispatched run sees the PR the prior one opened', () => {
    expect(workflow).toContain('group: feature-map');
    expect(workflow).toContain('cancel-in-progress: false');
  });
});
