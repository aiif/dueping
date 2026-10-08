import { Hono } from 'hono';
import { User, Contract } from '../shared/types';
import { validateContractInput } from '../shared/logic';
import { recognizeContract } from './recognition';
import { checkRateLimit } from './rateLimit';

export const contractsApp = new Hono<{ Bindings: Env; Variables: { user: User } }>();

/**
 * Recognize contract details from uploaded images using AI
 */
contractsApp.post('/recognize', async (c) => {
  const user = c.get('user');

  // Rate limit: 30 recognition requests per hour per user
  const limitCheck = await checkRateLimit(c.env.DB, `recognize:${user.id}`, 30, 3600);
  if (!limitCheck.allowed) {
    return c.json({ error: '合同识别过于频繁，每小时最多 30 次，请稍候重试' }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const images = Array.isArray(body?.images) ? body.images : [];
  if (images.length === 0) {
    return c.json({ error: '请上传至少一张合同图片' }, 400);
  }

  try {
    const result = await recognizeContract({
      env: c.env,
      user,
      images,
    });
    return c.json({ success: true, result });
  } catch (err: any) {
    return c.json({ error: err.message || '合同识别失败，请核对图片后重试' }, 500);
  }
});

/**
 * List all contracts for the authenticated user, sorted by end_date ASC
 */
contractsApp.get('/', async (c) => {
  const user = c.get('user');

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM contracts
    WHERE user_id = ?
    ORDER BY end_date ASC
  `).bind(user.id).all<Contract>();

  return c.json({
    contracts: results || [],
  });
});

/**
 * Get a single contract by ID.
 * Returns 404 if not found or unauthorized (越权访问返回 404).
 */
contractsApp.get('/:id', async (c) => {
  const user = c.get('user');
  const contractId = c.req.param('id');

  const contract = await c.env.DB.prepare(`
    SELECT * FROM contracts
    WHERE id = ? AND user_id = ?
  `).bind(contractId, user.id).first<Contract>();

  if (!contract) {
    return c.json({ error: '合同未找到' }, 404);
  }

  return c.json({ contract });
});

/**
 * Create a new contract
 */
contractsApp.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const validation = validateContractInput(body);
  if (!validation.valid || !validation.clean) {
    return c.json({ error: validation.error || '输入参数有误' }, 400);
  }

  const { name, client, start_date, end_date, amount, note, status } = validation.clean;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO contracts (id, user_id, name, client, start_date, end_date, amount, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, user.id, name, client, start_date, end_date, amount, note, status, now, now).run();

  const created: Contract = {
    id,
    user_id: user.id,
    name,
    client,
    start_date,
    end_date,
    amount,
    note,
    status,
    created_at: now,
    updated_at: now,
  };

  return c.json({ contract: created }, 201);
});

/**
 * Update an existing contract
 * Per SPEC:
 * - 标记"已续签"时必须填新到期日，并清空该合同的 reminders_sent
 * - 修改到期日同样清空
 * - 越权访问返回 404
 */
contractsApp.put('/:id', async (c) => {
  const user = c.get('user');
  const contractId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  // Check existence and ownership
  const existing = await c.env.DB.prepare(`
    SELECT * FROM contracts
    WHERE id = ? AND user_id = ?
  `).bind(contractId, user.id).first<Contract>();

  if (!existing) {
    return c.json({ error: '合同未找到' }, 404);
  }

  const validation = validateContractInput(body);
  if (!validation.valid || !validation.clean) {
    return c.json({ error: validation.error || '输入参数有误' }, 400);
  }

  const { name, client, start_date, end_date, amount, note, status } = validation.clean;

  // Rule: 标记"已续签"时必须填新到期日
  const isMarkingRenewed = status === 'renewed' && existing.status !== 'renewed';
  if (isMarkingRenewed && end_date === existing.end_date) {
    return c.json({ error: '标记已续签时必须填写新的到期日' }, 400);
  }

  // Clear reminders_sent if marked renewed or end_date changed
  const shouldResetReminders = isMarkingRenewed || end_date !== existing.end_date;
  if (shouldResetReminders) {
    await c.env.DB.prepare(`
      DELETE FROM reminders_sent WHERE contract_id = ?
    `).bind(contractId).run();
  }

  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    UPDATE contracts
    SET name = ?, client = ?, start_date = ?, end_date = ?, amount = ?, note = ?, status = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(name, client, start_date, end_date, amount, note, status, now, contractId, user.id).run();

  const updated: Contract = {
    id: contractId,
    user_id: user.id,
    name,
    client,
    start_date,
    end_date,
    amount,
    note,
    status,
    created_at: existing.created_at,
    updated_at: now,
  };

  return c.json({ contract: updated });
});

/**
 * Delete a contract.
 * Returns 404 if not found or unauthorized.
 */
contractsApp.delete('/:id', async (c) => {
  const user = c.get('user');
  const contractId = c.req.param('id');

  const existing = await c.env.DB.prepare(`
    SELECT id FROM contracts
    WHERE id = ? AND user_id = ?
  `).bind(contractId, user.id).first<{ id: string }>();

  if (!existing) {
    return c.json({ error: '合同未找到' }, 404);
  }

  // Clean up reminders_sent and contract
  await c.env.DB.prepare(`DELETE FROM reminders_sent WHERE contract_id = ?`).bind(contractId).run();
  await c.env.DB.prepare(`DELETE FROM contracts WHERE id = ? AND user_id = ?`).bind(contractId, user.id).run();

  return c.json({ success: true, message: '合同已删除' });
});
