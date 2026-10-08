/**
 * Rate limiting helper using D1 rate_limits table.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; currentCount: number; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

  const query = `
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
    RETURNING count;
  `;

  const result = await db.prepare(query).bind(key, windowStart).first<{ count: number }>();
  const currentCount = result?.count ?? 1;

  if (currentCount > limit) {
    return { allowed: false, currentCount, remaining: 0 };
  }
  return { allowed: true, currentCount, remaining: Math.max(0, limit - currentCount) };
}
