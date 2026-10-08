import { Hono } from 'hono';
import { User } from '../shared/types';
import { validateSettings } from '../shared/logic';
import { checkRateLimit } from './rateLimit';
import { sendEmail } from './email';

export const settingsApp = new Hono<{ Bindings: Env; Variables: { user: User } }>();

/**
 * Get current user settings
 */
settingsApp.get('/', async (c) => {
  const user = c.get('user');
  return c.json({
    email: user.email,
    reminder_days: user.reminder_days,
    send_hour: user.send_hour,
    timezone: user.timezone,
  });
});

/**
 * Update user settings
 */
settingsApp.put('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const validation = validateSettings(body);
  if (!validation.valid || !validation.clean) {
    return c.json({ error: validation.error || '设置参数有误' }, 400);
  }

  const { reminder_days, send_hour, timezone } = validation.clean;

  await c.env.DB.prepare(`
    UPDATE users
    SET reminder_days = ?, send_hour = ?, timezone = ?
    WHERE id = ?
  `).bind(JSON.stringify(reminder_days), send_hour, timezone, user.id).run();

  return c.json({
    success: true,
    settings: {
      reminder_days,
      send_hour,
      timezone,
    },
  });
});

/**
 * Send a test email to the authenticated user.
 * Per SPEC: Rate limited to 3 times per hour.
 */
settingsApp.post('/test-email', async (c) => {
  const user = c.get('user');

  // Rate limit: 3 times per hour
  const rateLimitKey = `test_email:${user.id}`;
  const rateLimit = await checkRateLimit(c.env.DB, rateLimitKey, 3, 3600);
  if (!rateLimit.allowed) {
    return c.json({ error: '测试邮件每小时最多发送 3 封，请稍后再试' }, 429);
  }

  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: user.timezone });
  const emailSubject = '【dueping】测试邮件：发信配置已成功生效！';
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; background-color: #f9fafb; padding: 24px; color: #1f2937;">
      <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 24px;">
        <h2 style="margin-top: 0; color: #16a34a;">测试邮件发送成功 🎉</h2>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          您好 <strong>${user.email}</strong>！<br>
          这是一封来自 <strong>dueping</strong> 的发信测试邮件。收到此邮件代表您的 Cloudflare Email Service 发信绑定工作正常！
        </p>
        <div style="background-color: #f3f4f6; padding: 14px 16px; border-radius: 6px; font-size: 14px; margin: 18px 0; color: #4b5563;">
          <div><strong>当前配置提醒档位：</strong>到期前 ${user.reminder_days.join(' / ')} 天</div>
          <div style="margin-top: 4px;"><strong>每日提醒时间：</strong>本地 ${user.send_hour}:00</div>
          <div style="margin-top: 4px;"><strong>用户时区：</strong>${user.timezone}</div>
          <div style="margin-top: 4px;"><strong>测试时间：</strong>${nowStr}</div>
        </div>
        <p style="color: #6b7280; font-size: 13px;">
          当您录入的合同临近到期时，系统会在每日 ${user.send_hour}:00 自动为您推送汇总提醒邮件。
        </p>
      </div>
    </body>
    </html>
  `.trim();

  const emailText = `您好 ${user.email}！这是一封来自 dueping 的测试邮件，说明发信绑定工作正常。当前配置提醒档位：到期前 ${user.reminder_days.join(' / ')} 天，发送时间：本地 ${user.send_hour}:00，时区：${user.timezone}。`;

  const result = await sendEmail(c.env, {
    to: user.email,
    subject: emailSubject,
    html: emailHtml,
    text: emailText,
  });

  if (!result.success) {
    return c.json({ error: `发送测试邮件失败: ${result.error || '未知错误'}` }, 500);
  }

  return c.json({
    success: true,
    message: '测试邮件已发送，请检查您的收件箱（若未收到可查看垃圾邮件箱）',
  });
});
