import { Contract, ContractStatus, PendingReminderItem, UserSettings, ContractRecognizeResult } from './types';

/**
 * Escapes characters for HTML safe rendering.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes email by trimming and converting to lowercase.
 */
export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  // Basic email pattern check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validates an IANA timezone string using Intl.DateTimeFormat.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculates calendar day difference between endDate and today (both in YYYY-MM-DD).
 * Per SPEC: Pure calendar day arithmetic, no ms/86400000 approximation.
 * Returns endDate - today.
 */
export function calculateDaysLeft(endDate: string, today: string): number {
  const [ey, em, ed] = endDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const utcEnd = Date.UTC(ey, em - 1, ed);
  const utcToday = Date.UTC(ty, tm - 1, td);
  return Math.round((utcEnd - utcToday) / 86400000);
}

/**
 * Determines the reminder tier for a given daysLeft.
 * Per SPEC:
 * tier = minimum x in reminder_days where days_left <= x;
 * if none, or if days_left < 0, returns null.
 */
export function determineTier(reminderDays: number[], daysLeft: number): number | null {
  if (daysLeft < 0) return null;
  const eligible = reminderDays.filter((x) => daysLeft <= x);
  if (eligible.length === 0) return null;
  return Math.min(...eligible);
}

/**
 * Extracts local date (YYYY-MM-DD) and local hour (0-23) for a given Date and timezone.
 */
export function getLocalTimeInfo(date: Date, timeZone: string): { today: string; hour: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let year = '';
  let month = '';
  let day = '';
  let hour = 0;
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'day') day = part.value;
    if (part.type === 'hour') hour = parseInt(part.value, 10);
  }
  return {
    today: `${year}-${month}-${day}`,
    hour: hour % 24,
  };
}

/**
 * Validates user reminder settings.
 * Per SPEC:
 * - reminder_days: integer array, each 1-365, deduplicated, 1-6 items, default [30,15,7]
 * - send_hour: 0-23, default 9
 * - timezone: IANA timezone, default Asia/Shanghai
 */
export function validateSettings(input: unknown): {
  valid: boolean;
  error?: string;
  clean?: UserSettings;
} {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: '设置参数无效' };
  }
  const s = input as Record<string, unknown>;

  // 1. reminder_days
  let reminderDays: number[] = [30, 15, 7];
  if (s.reminder_days !== undefined) {
    if (!Array.isArray(s.reminder_days)) {
      return { valid: false, error: '提醒天数必须是数组' };
    }
    const cleanDays: number[] = [];
    for (const item of s.reminder_days) {
      const num = Number(item);
      if (!Number.isInteger(num) || num < 1 || num > 365) {
        return { valid: false, error: '提醒天数必须是 1 到 365 之间的整数' };
      }
      if (!cleanDays.includes(num)) {
        cleanDays.push(num);
      }
    }
    if (cleanDays.length < 1 || cleanDays.length > 6) {
      return { valid: false, error: '提醒天数去重后需包含 1 至 6 项' };
    }
    cleanDays.sort((a, b) => b - a); // Sort descending
    reminderDays = cleanDays;
  }

  // 2. send_hour
  let sendHour = 9;
  if (s.send_hour !== undefined) {
    const num = Number(s.send_hour);
    if (!Number.isInteger(num) || num < 0 || num > 23) {
      return { valid: false, error: '发送时间必须是 0 到 23 之间的整数小时' };
    }
    sendHour = num;
  }

  // 3. timezone
  let timezone = 'Asia/Shanghai';
  if (s.timezone !== undefined) {
    if (typeof s.timezone !== 'string' || !isValidTimezone(s.timezone)) {
      return { valid: false, error: '时区格式不合法，请输入有效的 IANA 时区（如 Asia/Shanghai）' };
    }
    timezone = s.timezone;
  }

  // 4. Optional AI configuration
  let aiApiKey: string | null | undefined = undefined;
  if (s.ai_api_key !== undefined) {
    aiApiKey = typeof s.ai_api_key === 'string' ? s.ai_api_key.trim() || null : null;
  }

  let aiBaseUrl: string | null | undefined = undefined;
  if (s.ai_base_url !== undefined) {
    aiBaseUrl = typeof s.ai_base_url === 'string' ? s.ai_base_url.trim() || null : null;
  }

  let aiModel: string | null | undefined = undefined;
  if (s.ai_model !== undefined) {
    aiModel = typeof s.ai_model === 'string' ? s.ai_model.trim() || null : null;
  }

  return {
    valid: true,
    clean: {
      reminder_days: reminderDays,
      send_hour: sendHour,
      timezone,
      ...(aiApiKey !== undefined ? { ai_api_key: aiApiKey } : {}),
      ...(aiBaseUrl !== undefined ? { ai_base_url: aiBaseUrl } : {}),
      ...(aiModel !== undefined ? { ai_model: aiModel } : {}),
    },
  };
}

/**
 * Normalizes and validates contract status.
 */
export function normalizeContractStatus(status: unknown): ContractStatus {
  if (status === 'renewed' || status === '已续签') return 'renewed';
  if (status === 'terminated' || status === '已终止') return 'terminated';
  return 'active';
}

/**
 * Formats status for UI display in Chinese.
 */
export function formatContractStatus(status: ContractStatus): string {
  switch (status) {
    case 'renewed':
      return '已续签';
    case 'terminated':
      return '已终止';
    default:
      return '进行中';
  }
}

/**
 * Validates a contract input payload.
 */
export function validateContractInput(input: unknown): {
  valid: boolean;
  error?: string;
  clean?: {
    name: string;
    client: string;
    start_date: string | null;
    end_date: string;
    amount: number | null;
    note: string | null;
    status: ContractStatus;
  };
} {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: '合同数据无效' };
  }
  const c = input as Record<string, unknown>;

  // name
  if (typeof c.name !== 'string' || !c.name.trim()) {
    return { valid: false, error: '合同名称不能为空' };
  }
  const name = c.name.trim();
  if (name.length > 100) {
    return { valid: false, error: '合同名称不能超过 100 个字符' };
  }

  // client (甲方)
  if (typeof c.client !== 'string' || !c.client.trim()) {
    return { valid: false, error: '甲方名称不能为空' };
  }
  const client = c.client.trim();
  if (client.length > 100) {
    return { valid: false, error: '甲方名称不能超过 100 个字符' };
  }

  // date format regex YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  // end_date
  if (typeof c.end_date !== 'string' || !dateRegex.test(c.end_date)) {
    return { valid: false, error: '到期日格式必须为 YYYY-MM-DD' };
  }
  const endDate = c.end_date;

  // start_date (optional)
  let startDate: string | null = null;
  if (c.start_date) {
    if (typeof c.start_date !== 'string' || !dateRegex.test(c.start_date)) {
      return { valid: false, error: '起始日格式必须为 YYYY-MM-DD' };
    }
    startDate = c.start_date;
  }

  // amount (optional)
  let amount: number | null = null;
  if (c.amount !== undefined && c.amount !== null && c.amount !== '') {
    const num = Number(c.amount);
    if (isNaN(num) || num < 0) {
      return { valid: false, error: '金额必须是非负数' };
    }
    amount = num;
  }

  // note (optional)
  let note: string | null = null;
  if (typeof c.note === 'string' && c.note.trim()) {
    note = c.note.trim();
    if (note.length > 1000) {
      return { valid: false, error: '备注不能超过 1000 个字符' };
    }
  }

  // status
  const status = normalizeContractStatus(c.status);

  return {
    valid: true,
    clean: {
      name,
      client,
      start_date: startDate,
      end_date: endDate,
      amount,
      note,
      status,
    },
  };
}

/**
 * Generates a 6-digit random OTP using crypto.getRandomValues.
 */
export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = (buf[0] % 1000000).toString().padStart(6, '0');
  return code;
}

/**
 * Generates a random salt (hex string).
 */
export function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes SHA-256 hash of (salt + ":" + code) as hex string.
 */
export async function hashOtpCode(code: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${code}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Timing-safe string comparison using crypto.subtle.timingSafeEqual.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let mismatch = a.length === b.length ? 0 : 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

/**
 * Generates a 32-byte session token (hex string).
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes SHA-256 hash of a session token (hex string).
 */
export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates an OTP attempt against stored code_hash, salt, expires_at, and attempts count.
 */
export async function verifyOtpAttempt(params: {
  enteredCode: string;
  salt: string;
  storedHash: string;
  expiresAt: string;
  attempts: number;
  maxAttempts?: number;
  now?: number;
}): Promise<{
  success: boolean;
  expired?: boolean;
  locked?: boolean;
  invalid?: boolean;
}> {
  const {
    enteredCode,
    salt,
    storedHash,
    expiresAt,
    attempts,
    maxAttempts = 5,
    now = Date.now(),
  } = params;

  if (now > new Date(expiresAt).getTime()) {
    return { success: false, expired: true };
  }

  if (attempts >= maxAttempts) {
    return { success: false, locked: true };
  }

  const computedHash = await hashOtpCode(enteredCode, salt);
  const match = timingSafeEqualStr(computedHash, storedHash);

  if (!match) {
    return { success: false, invalid: true };
  }

  return { success: true };
}

/**
 * Pure function to calculate pending reminders for a single user scan.
 * Per SPEC:
 * - Checks local_hour >= send_hour. If not, returns null.
 * - For each active contract:
 *   - days_left = end_date - local_today
 *   - if days_left < 0, skip
 *   - tier = min reminder_days where days_left <= x; if none, skip
 *   - if (contract_id, tier, end_date) in remindersSentSet, skip
 *   - else add to pending
 * - If pending is not empty, returns pending list, min daysLeft, subject, html, text.
 */
export function planUserReminders(params: {
  user: {
    id: string;
    email: string;
    reminder_days: number[];
    send_hour: number;
    timezone: string;
  };
  contracts: Contract[];
  remindersSentKeys: Set<string>; // Set of `${contract_id}:${tier}:${end_date}`
  currentDate?: Date;
}): {
  shouldSend: boolean;
  reason?: string;
  items: PendingReminderItem[];
  emailSubject?: string;
  emailHtml?: string;
  emailText?: string;
  minDaysLeft?: number;
} {
  const { user, contracts, remindersSentKeys, currentDate = new Date() } = params;

  const { today: localToday, hour: localHour } = getLocalTimeInfo(currentDate, user.timezone);

  // send_hour gating (>= send_hour)
  if (localHour < user.send_hour) {
    return {
      shouldSend: false,
      reason: `未到配置的发送小时（当前本地 ${localHour} 点，配置 ${user.send_hour} 点）`,
      items: [],
    };
  }

  const items: PendingReminderItem[] = [];

  for (const contract of contracts) {
    // Only active contracts are scanned
    if (contract.status !== 'active') continue;

    const daysLeft = calculateDaysLeft(contract.end_date, localToday);
    if (daysLeft < 0) {
      // Expired, skip
      continue;
    }

    const tier = determineTier(user.reminder_days, daysLeft);
    if (tier === null) {
      // Not yet in any reminder window
      continue;
    }

    const sentKey = `${contract.id}:${tier}:${contract.end_date}`;
    if (remindersSentKeys.has(sentKey)) {
      // Already sent this tier for this end_date
      continue;
    }

    items.push({
      contract,
      tier,
      days_left: daysLeft,
    });
  }

  if (items.length === 0) {
    return {
      shouldSend: false,
      reason: '没有需要发送提醒的合同',
      items: [],
    };
  }

  // Sort items by days_left ascending (most urgent first)
  items.sort((a, b) => a.days_left - b.days_left);

  const minDaysLeft = items[0].days_left;
  const count = items.length;

  const emailSubject = `【dueping】合同到期提醒：距最近到期仅剩 ${minDaysLeft} 天（共 ${count} 份合同）`;

  // Generate plain text
  const textLines: string[] = [
    `您好！`,
    ``,
    `dueping 提醒您，您有 ${count} 份合同即将到期，最紧迫合同剩余 ${minDaysLeft} 天。`,
    `请联系甲方确认：是否续签？款项是否已结清？`,
    ``,
    `----------------------------------------`,
  ];

  for (const item of items) {
    const c = item.contract;
    const amountStr = c.amount !== null && c.amount !== undefined ? `¥${c.amount}` : '未填写';
    textLines.push(`- 合同名称: ${c.name}`);
    textLines.push(`  甲方: ${c.client}`);
    textLines.push(`  到期日: ${c.end_date}（剩余 ${item.days_left} 天，触发 ${item.tier} 天档位）`);
    textLines.push(`  金额: ${amountStr}`);
    if (c.note) {
      textLines.push(`  备注: ${c.note}`);
    }
    textLines.push(`----------------------------------------`);
  }

  textLines.push(``);
  textLines.push(`请及时登录 dueping 查看或处理合同。`);
  textLines.push(`https://dueping.toreal.site`);

  const emailText = textLines.join('\n');

  // Generate HTML with escaped user input
  const htmlRows = items
    .map((item) => {
      const c = item.contract;
      const amountStr = c.amount !== null && c.amount !== undefined ? `¥${c.amount}` : '未填写';
      const noteHtml = c.note
        ? `<div style="font-size: 13px; color: #6b7280; margin-top: 4px;">备注：${escapeHtml(c.note)}</div>`
        : '';
      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px 8px; font-weight: 600; color: #111827;">${escapeHtml(c.name)}${noteHtml}</td>
          <td style="padding: 12px 8px; color: #374151;">${escapeHtml(c.client)}</td>
          <td style="padding: 12px 8px; color: #374151;">${escapeHtml(c.end_date)}</td>
          <td style="padding: 12px 8px; font-weight: 600; color: #dc2626;">剩余 ${item.days_left} 天</td>
          <td style="padding: 12px 8px; color: #374151;">${escapeHtml(amountStr)}</td>
        </tr>
      `;
    })
    .join('');

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(emailSubject)}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; padding: 24px; color: #1f2937;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <h2 style="margin-top: 0; color: #111827; font-size: 20px;">dueping 合同到期提醒</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #374151;">
          您好！您有 <strong>${count}</strong> 份合同即将到期，其中最近一份距到期仅剩 <span style="color: #dc2626; font-weight: bold; font-size: 18px;">${minDaysLeft}</span> 天。
        </p>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <strong style="color: #991b1b; font-size: 15px;">请联系甲方确认：是否续签？款项是否已结清？</strong>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; text-align: left;">
          <thead>
            <tr style="border-bottom: 2px solid #e5e7eb; color: #4b5563;">
              <th style="padding: 8px;">合同名</th>
              <th style="padding: 8px;">甲方</th>
              <th style="padding: 8px;">到期日</th>
              <th style="padding: 8px;">剩余天数</th>
              <th style="padding: 8px;">金额</th>
            </tr>
          </thead>
          <tbody>
            ${htmlRows}
          </tbody>
        </table>
        <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: center;">
          <p style="margin: 0 0 8px 0;">该提醒由 <a href="https://dueping.toreal.site" style="color: #2563eb; text-decoration: none;">dueping</a> 自动发送</p>
          <a href="https://dueping.toreal.site" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px;">进入系统处理</a>
        </div>
      </div>
    </body>
    </html>
  `.trim();

  return {
    shouldSend: true,
    items,
    minDaysLeft,
    emailSubject,
    emailHtml,
    emailText,
  };
}

/**
 * Normalizes a date string from OCR/LLM to YYYY-MM-DD format if valid.
 */
export function normalizeDateString(dateStr: unknown): string | null {
  if (typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;

  // Pattern 1: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return s;
  }

  // Pattern 2: YYYY/MM/DD or YYYY.MM.DD
  const slashDotMatch = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (slashDotMatch) {
    const y = slashDotMatch[1];
    const m = slashDotMatch[2].padStart(2, '0');
    const d = slashDotMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Pattern 3: YYYY年MM月DD日
  const cnMatch = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (cnMatch) {
    const y = cnMatch[1];
    const m = cnMatch[2].padStart(2, '0');
    const d = cnMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Normalizes an amount value from OCR/LLM to a valid positive number or null.
 */
export function normalizeAmount(amountVal: unknown): number | null {
  if (typeof amountVal === 'number') {
    return isNaN(amountVal) || amountVal < 0 ? null : Math.round(amountVal * 100) / 100;
  }
  if (typeof amountVal === 'string') {
    const s = amountVal.trim();
    if (!s) return null;
    let clean = s.replace(/[¥,，￥\s元]/g, '');
    if (/万$/.test(clean) || /万元$/.test(s)) {
      const num = parseFloat(clean.replace('万', ''));
      return isNaN(num) || num < 0 ? null : Math.round(num * 10000 * 100) / 100;
    }
    const num = parseFloat(clean);
    return isNaN(num) || num < 0 ? null : Math.round(num * 100) / 100;
  }
  return null;
}

/**
 * Parses and cleans contract recognition JSON response from an LLM.
 * Handles markdown code fences, plain json, and dirty formatting.
 */
export function parseContractRecognitionJson(rawText: string): ContractRecognizeResult {
  if (!rawText || typeof rawText !== 'string') {
    return { confidence: 'low', summary: '未收到有效的模型返回内容' };
  }

  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      confidence: 'low',
      summary: '识别结果格式解析失败，请核对并手动填写',
    };
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 100) : undefined;
  const client = typeof parsed.client === 'string' ? parsed.client.trim().slice(0, 100) : undefined;
  const startDate = normalizeDateString(parsed.start_date);
  const endDate = normalizeDateString(parsed.end_date);
  const amount = normalizeAmount(parsed.amount);
  const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 500) : null;
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 200) : undefined;

  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (name && client && endDate) {
    confidence = 'high';
  } else if (name || client || endDate) {
    confidence = 'medium';
  }

  return {
    name,
    client,
    start_date: startDate,
    end_date: endDate || undefined,
    amount,
    note,
    summary,
    confidence,
  };
}

