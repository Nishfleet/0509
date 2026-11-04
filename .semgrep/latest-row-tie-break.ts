// ruleid: latest-row-tie-break
export const pastMistake = `(SELECT mv.p FROM jev_verdict mv WHERE mv.signal_id = s.id AND mv.question_id = 'q' ORDER BY mv.decided_at DESC LIMIT 1)`;

// ruleid: latest-row-tie-break
export const ascending = `SELECT id FROM page ORDER BY url LIMIT 1`;

export const multiLine = `SELECT id FROM send_attempt
  // ruleid: latest-row-tie-break
  ORDER BY attempted_at DESC
  LIMIT 1`;

// ok: latest-row-tie-break
export const fixed = `(SELECT mv.p FROM jev_verdict mv WHERE mv.signal_id = s.id ORDER BY mv.decided_at DESC, mv.id DESC LIMIT 1)`;

// ok: latest-row-tie-break
export const limitTen = `SELECT id FROM signal ORDER BY created_at DESC LIMIT 10`;
