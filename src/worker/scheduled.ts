import { User, Contract } from '../shared/types';
import { planUserReminders } from '../shared/logic';
import { sendEmail } from './email';

/**
 * Scheduled handler executed on Cron triggers (0 * * * *)
 */
export async function handleScheduled(env: Env): Promise<{
  scannedUsers: number;
  emailsSent: number;
  errors: number;
}> {
  console.log('[dueping Scheduled] Cron execution started');
  const now = new Date();
  const nowIso = now.toISOString();
  const oneDayAgoSeconds = Math.floor(now.getTime() / 1000) - 86400;

  // 1. Cleanup expired records: otp_codes, sessions, rate_limits
  try {
    await env.DB.prepare('DELETE FROM otp_codes WHERE expires_at < ?').bind(nowIso).run();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso).run();
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(oneDayAgoSeconds).run();
    console.log('[dueping Scheduled] Cleaned up expired OTPs, sessions, and rate limits');
  } catch (cleanErr) {
    console.error('[dueping Scheduled] Error cleaning up expired records:', cleanErr);
  }

  // 2. Scan all users
  let scannedUsers = 0;
  let emailsSent = 0;
  let errors = 0;

  try {
    const { results: userRows } = await env.DB.prepare(`
      SELECT id, email, reminder_days, send_hour, timezone, created_at
      FROM users
    `).all<{
      id: string;
      email: string;
      reminder_days: string;
      send_hour: number;
      timezone: string;
      created_at: string;
    }>();

    if (!userRows || userRows.length === 0) {
      console.log('[dueping Scheduled] No users found');
      return { scannedUsers: 0, emailsSent: 0, errors: 0 };
    }

    scannedUsers = userRows.length;

    for (const row of userRows) {
      try {
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

        // Fetch active contracts for this user
        const { results: contracts } = await env.DB.prepare(`
          SELECT * FROM contracts
          WHERE user_id = ? AND status = 'active'
        `).bind(user.id).all<Contract>();

        if (!contracts || contracts.length === 0) {
          continue;
        }

        // Fetch sent reminder records for these contracts
        const { results: sentRows } = await env.DB.prepare(`
          SELECT rs.contract_id, rs.tier, rs.end_date
          FROM reminders_sent rs
          JOIN contracts c ON rs.contract_id = c.id
          WHERE c.user_id = ?
        `).bind(user.id).all<{ contract_id: string; tier: number; end_date: string }>();

        const remindersSentKeys = new Set<string>();
        if (sentRows) {
          for (const s of sentRows) {
            remindersSentKeys.add(`${s.contract_id}:${s.tier}:${s.end_date}`);
          }
        }

        // Plan reminders for this user
        const plan = planUserReminders({
          user,
          contracts,
          remindersSentKeys,
          currentDate: now,
        });

        if (!plan.shouldSend || !plan.emailSubject || !plan.emailHtml || !plan.emailText) {
          continue;
        }

        console.log(`[dueping Scheduled] Sending reminder digest to ${user.email} for ${plan.items.length} contracts: ${plan.items.map(i => i.contract.name).join(', ')}`);

        // Send email
        const sendResult = await sendEmail(env, {
          to: user.email,
          subject: plan.emailSubject,
          html: plan.emailHtml,
          text: plan.emailText,
        });

        if (sendResult.success) {
          emailsSent++;
          // Only after send success: batch write to reminders_sent
          for (const item of plan.items) {
            await env.DB.prepare(`
              INSERT OR IGNORE INTO reminders_sent (contract_id, tier, end_date, sent_at)
              VALUES (?, ?, ?, ?)
            `).bind(item.contract.id, item.tier, item.contract.end_date, new Date().toISOString()).run();
          }
          console.log(`[dueping Scheduled] Successfully recorded reminders_sent for ${user.email}`);
        } else {
          errors++;
          console.error(`[dueping Scheduled] Failed to send email to ${user.email}:`, sendResult.error);
        }
      } catch (userErr) {
        errors++;
        // Single user error does not impact other users
        console.error(`[dueping Scheduled] Error processing user ${row.id} (${row.email}):`, userErr);
      }
    }
  } catch (err) {
    console.error('[dueping Scheduled] Fatal scan error:', err);
  }

  console.log(`[dueping Scheduled] Finished. Scanned ${scannedUsers} users, sent ${emailsSent} emails, encountered ${errors} errors.`);
  return { scannedUsers, emailsSent, errors };
}
