export interface BreakageEvidence {
  status: number;
  httpError: boolean;
  beforeChars: number;
  afterChars: number;
  textHalved: boolean;
  pricesBefore: number;
  pricesAfter: number;
  pricesVanished: boolean;
}

export function computeBreakageEvidence(input: {
  status: number;
  beforeText: string;
  afterText: string;
}): BreakageEvidence {
  const beforeChars = input.beforeText.length;
  const afterChars = input.afterText.length;
  const pricesBefore = countPrices(input.beforeText);
  const pricesAfter = countPrices(input.afterText);
  return {
    status: input.status,
    httpError: input.status >= 400,
    beforeChars,
    afterChars,
    textHalved: afterChars < beforeChars / 2,
    pricesBefore,
    pricesAfter,
    pricesVanished: pricesBefore > 0 && pricesAfter === 0,
  };
}

function countPrices(text: string): number {
  return text.match(/[£$€₹]\s?\d/g)?.length ?? 0;
}
