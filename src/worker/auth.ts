import { Hono, Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  generateOtpCode,
  generateSalt,
  hashOtpCode,
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  verifyOtpAttempt,
} from '../shared/logic';
import { User } from '../shared/types';
import { checkRateLimit } from './rateLimit';
import { sendEmail } from './email';

export const authApp = new Hono<{ Bindings: Env; Variables: { user: User; sessionTokenHash: string } }>();

// CSRF middleware for write operations
export const csrfMiddleware = async (c: Context, next: Next) => {
  const method = c.req.method;
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const contentType = c.req.header('content-type') || '';
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (!contentType.includes('application/json')) {
        return c.json({ error: 'Content-Type 必须为 application/json' }, 415);
      }
    }

    const origin = c.req.header('origin');
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const requestUrl = new URL(c.req.url);
        const isMatch =
          originUrl.host === requestUrl.host ||
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === '127.0.0.1' ||
          originUrl.hostname.endsWith('dueping.toreal.site');
        if (!isMatch) {
          return c.json({ error: '跨域请求被拒绝' }, 403);
        }
      } catch {
        return c.json({ error: 'Origin 头非法' }, 403);
      }
    }
  }
  await next();
};

// Auth middleware to authenticate requests via session cookie
export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: { user: User; sessionTokenHash: string } }>, next: Next) => {
  const token = getCookie(c, 'dueping_session');
  if (!token) {
    return c.json({ error: '未登录' }, 401);
  }

  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();

  const row = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.reminder_days, u.send_hour, u.timezone, u.created_at, s.expires_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, now).first<{
    id: string;
    email: string;
    reminder_days: string;
    send_hour: number;
    timezone: string;
    created_at: string;
    expires_at: string;
  }>();

  if (!row) {
    deleteCookie(c, 'dueping_session', { path: '/' });
    return c.json({ error: '登录会话已过期或无效' }, 401);
  }

  let reminderDays = [30, 15, 7];
  try {
    reminderDays = JSON.parse(row.reminder_days);
  } catch {}

  const user: User = {
    id: row.id,
    email: row.email,
    reminder_days: reminderDays,
    send_hour: row.send_hour,
    timezone: row.timezone,
    created_at: row.created_at,
  };

  c.set('user', user);
  c.set('sessionTokenHash', tokenHash);
  await next();
};

/**
 * Request an OTP verification code
 */
authApp.post('/otp/request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!email) {
    return c.json({ error: '请输入有效的邮箱地址' }, 400);
  }

  const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';

  // 1. Rate limit: Same email 60s cooldown
  const cooldown = await checkRateLimit(c.env.DB, `email_cd:${email}`, 1, 60);
  if (!cooldown.allowed) {
    return c.json({ error: '验证码发送太频繁，请 60 秒后再试' }, 429);
  }

  // 2. Rate limit: Same email <= 5 per hour
  const emailHourLimit = await checkRateLimit(c.env.DB, `email_hr:${email}`, 5, 3600);
  if (!emailHourLimit.allowed) {
    return c.json({ error: '该邮箱验证码发送过于频繁，请 1 小时后再试' }, 429);
  }

  // 3. Rate limit: Same IP <= 20 per hour
  const ipHourLimit = await checkRateLimit(c.env.DB, `ip_hr:${ip}`, 20, 3600);
  if (!ipHourLimit.allowed) {
    return c.json({ error: '当前网络请求过于频繁，请 1 小时后再试' }, 429);
  }

  const code = generateOtpCode();
  const salt = generateSalt();
  const codeHash = await hashOtpCode(code, salt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const otpId = crypto.randomUUID();

  // Invalidate previous OTP codes for this email
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();

  // Insert new OTP
  await c.env.DB.prepare(`
    INSERT INTO otp_codes (id, email, salt, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).bind(otpId, email, salt, codeHash, expiresAt, now.toISOString()).run();

  // Crucial: Log verification code to console for local testing and smoke tests
  console.log(`[dueping OTP] Verification code for ${email}: ${code}`);

  // Send verification email
  const emailSubject = `【dueping】您的登录验证码是：${code}`;
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; background-color: #f9fafb; padding: 24px; color: #1f2937;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 24px;">
        <h2 style="margin-top: 0; color: #111827;">dueping 登录验证码</h2>
        <p style="color: #4b5563; font-size: 15px;">您好！您正在登录 dueping 合同到期提醒系统，验证码为：</p>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
          <span style="font-family: monospace; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #2563eb;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 13px;">验证码 10 分钟内有效，仅可使用一次。如非本人操作，请忽略此邮件。</p>
      </div>
    </body>
    </html>
  `.trim();
  const emailText = `您好！您正在登录 dueping，验证码为：${code}。验证码 10 分钟内有效，仅可使用一次。如非本人操作请忽略。`;

  // Send via Cloudflare Email Service binding (background / non-blocking if fails, log)
  await sendEmail(c.env, {
    to: email,
    subject: emailSubject,
    html: emailHtml,
    text: emailText,
  });

  return c.json({
    success: true,
    message: '验证码已发送至您的邮箱，请在 10 分钟内输入',
  });
});

/**
 * Verify OTP and login / auto-register
 */
authApp.post('/otp/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  if (!email || code.length !== 6) {
    return c.json({ error: '邮箱格式或验证码格式不正确' }, 400);
  }

  // Fetch the latest OTP record
  const record = await c.env.DB.prepare(`
    SELECT * FROM otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1
  `).bind(email).first<{
    id: string;
    email: string;
    salt: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    created_at: string;
  }>();

  if (!record) {
    return c.json({ error: '验证码不存在或已失效，请重新获取' }, 400);
  }

  const result = await verifyOtpAttempt({
    enteredCode: code,
    salt: record.salt,
    storedHash: record.code_hash,
    expiresAt: record.expires_at,
    attempts: record.attempts,
    maxAttempts: 5,
  });

  if (!result.success) {
    if (result.expired) {
      await c.env.DB.prepare('DELETE FROM otp_codes WHERE id = ?').bind(record.id).run();
      return c.json({ error: '验证码已过期，请重新获取' }, 400);
    }
    if (result.locked) {
      await c.env.DB.prepare('DELETE FROM otp_codes WHERE id = ?').bind(record.id).run();
      return c.json({ error: '验证码连续输错达 5 次已作废，请重新获取' }, 400);
    }
    // Invalid code, increment attempts
    const nextAttempts = record.attempts + 1;
    if (nextAttempts >= 5) {
      await c.env.DB.prepare('DELETE FROM otp_codes WHERE id = ?').bind(record.id).run();
      return c.json({ error: '验证码错误达 5 次已作废，请重新获取' }, 400);
    } else {
      await c.env.DB.prepare('UPDATE otp_codes SET attempts = ? WHERE id = ?').bind(nextAttempts, record.id).run();
      return c.json({ error: `验证码错误，还剩 ${5 - nextAttempts} 次机会` }, 400);
    }
  }

  // Success: burn OTP code immediately
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE id = ?').bind(record.id).run();

  // Find or create user
  let userRow = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<{
    id: string;
    email: string;
    reminder_days: string;
    send_hour: number;
    timezone: string;
    created_at: string;
  }>();

  if (!userRow) {
    const newUserId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO users (id, email, reminder_days, send_hour, timezone, created_at)
      VALUES (?, ?, '[30,15,7]', 9, 'Asia/Shanghai', ?)
    `).bind(newUserId, email, createdAt).run();

    userRow = {
      id: newUserId,
      email,
      reminder_days: '[30,15,7]',
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: createdAt,
    };
  }

  // Create session
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await c.env.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(tokenHash, userRow.id, expiresAt).run();

  const isHttps = c.req.url.startsWith('https://');

  setCookie(c, 'dueping_session', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60,
  });

  let reminderDays = [30, 15, 7];
  try {
    reminderDays = JSON.parse(userRow.reminder_days);
  } catch {}

  return c.json({
    success: true,
    user: {
      id: userRow.id,
      email: userRow.email,
      reminder_days: reminderDays,
      send_hour: userRow.send_hour,
      timezone: userRow.timezone,
      created_at: userRow.created_at,
    },
  });
});

/**
 * Get current user profile
 */
authApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({
    user,
  });
});

/**
 * Logout and destroy session
 */
authApp.post('/logout', async (c) => {
  const token = getCookie(c, 'dueping_session');
  if (token) {
    const tokenHash = await hashSessionToken(token);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  deleteCookie(c, 'dueping_session', { path: '/' });
  return c.json({ success: true, message: '已退出登录' });
});
