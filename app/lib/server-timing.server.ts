interface Timings {
  measure<T>(name: string, work: Promise<T>): Promise<T>;
  header(): { "Server-Timing": string };
}

export function createTimings(): Timings {
  const started = performance.now();
  const entries: string[] = [];
  return {
    async measure<T>(name: string, work: Promise<T>): Promise<T> {
      const begin = performance.now();
      try {
        return await work;
      } finally {
        entries.push(`${name};dur=${(performance.now() - begin).toFixed(0)}`);
      }
    },
    header() {
      return { "Server-Timing": [...entries, `total;dur=${(performance.now() - started).toFixed(0)}`].join(", ") };
    },
  };
}
