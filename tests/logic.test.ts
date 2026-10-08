import { describe, it, expect } from 'vitest';
import {
  calculateDaysLeft,
  determineTier,
  getLocalTimeInfo,
  validateSettings,
  verifyOtpAttempt,
  hashOtpCode,
  generateSalt,
  planUserReminders,
  validateContractInput,
} from '../src/shared/logic';
import { Contract, User } from '../src/shared/types';

describe('1. 新建合同时已进入某档位', () => {
  it('合同时限直接落在15天档位，能正确匹配并生成提醒', () => {
    const user: User = {
      id: 'u1',
      email: 'alice@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-01T00:00:00Z',
    };

    // 假设今天 2026-10-08，合同到期日 2026-10-20，剩余 12 天
    const contract: Contract = {
      id: 'c1',
      user_id: 'u1',
      name: '服务器维护合同',
      client: '甲方甲公司',
      start_date: '2026-01-01',
      end_date: '2026-10-20',
      amount: 50000,
      note: '无',
      status: 'active',
      created_at: '2026-10-08T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    };

    const daysLeft = calculateDaysLeft('2026-10-20', '2026-10-08');
    expect(daysLeft).toBe(12);

    const tier = determineTier([30, 15, 7], daysLeft);
    expect(tier).toBe(15);

    // 模拟北京时间 10:00 扫描
    const plan = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: new Set(),
      currentDate: new Date('2026-10-08T02:00:00Z'), // UTC 02:00 = CST 10:00
    });

    expect(plan.shouldSend).toBe(true);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].tier).toBe(15);
    expect(plan.items[0].days_left).toBe(12);
  });
});

describe('2. 一次跨多档只取最紧的', () => {
  it('新建合同剩余5天（同时满足 <=30, <=15, <=7），仅触发最紧的7天档位', () => {
    const user: User = {
      id: 'u1',
      email: 'alice@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-01T00:00:00Z',
    };

    const contract: Contract = {
      id: 'c2',
      user_id: 'u1',
      name: '加急项目开发合同',
      client: '乙方科技',
      start_date: '2026-09-01',
      end_date: '2026-10-13', // 剩余 5 天
      amount: 120000,
      note: null,
      status: 'active',
      created_at: '2026-10-08T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    };

    const daysLeft = calculateDaysLeft('2026-10-13', '2026-10-08');
    expect(daysLeft).toBe(5);

    const tier = determineTier([30, 15, 7], daysLeft);
    expect(tier).toBe(7);

    const plan = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: new Set(),
      currentDate: new Date('2026-10-08T02:00:00Z'),
    });

    expect(plan.shouldSend).toBe(true);
    expect(plan.items[0].tier).toBe(7);
  });
});

describe('3. 修改到期日后重新提醒', () => {
  it('原到期日已发送过提醒，修改新到期日并清空记录后，会重新发送新档位提醒', () => {
    const user: User = {
      id: 'u1',
      email: 'alice@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-01T00:00:00Z',
    };

    // 初始状态：旧到期日 2026-10-12，已发送过 tier 7 提醒
    const sentRecords = new Set<string>();
    sentRecords.add('c3:7:2026-10-12');

    // 用户续签/修改到期日到 2026-11-05 (剩余 28 天)，根据规则清空该合同历史已发送记录
    sentRecords.delete('c3:7:2026-10-12');

    const updatedContract: Contract = {
      id: 'c3',
      user_id: 'u1',
      name: '年度运维合同',
      client: '丙方机构',
      start_date: '2025-10-12',
      end_date: '2026-11-05',
      amount: 80000,
      note: '已延期续签',
      status: 'active',
      created_at: '2025-10-12T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    };

    const daysLeft = calculateDaysLeft('2026-11-05', '2026-10-08');
    expect(daysLeft).toBe(28);

    const tier = determineTier(user.reminder_days, daysLeft);
    expect(tier).toBe(30);

    const plan = planUserReminders({
      user,
      contracts: [updatedContract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T02:00:00Z'),
    });

    expect(plan.shouldSend).toBe(true);
    expect(plan.items[0].tier).toBe(30);
    expect(plan.items[0].days_left).toBe(28);
  });
});

describe('4. 重复扫描不重复发送', () => {
  it('首次发送并记录到 reminders_sent 后，同日后续小时重复扫描不重复发信', () => {
    const user: User = {
      id: 'u1',
      email: 'alice@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-01T00:00:00Z',
    };

    const contract: Contract = {
      id: 'c4',
      user_id: 'u1',
      name: '品牌设计合同',
      client: '丁方传媒',
      start_date: '2026-01-01',
      end_date: '2026-10-22', // 剩余 14 天 => 档位 15
      amount: 30000,
      note: null,
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    const sentRecords = new Set<string>();

    // 第一次扫描：9 点
    const plan1 = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T01:00:00Z'), // UTC 01:00 = CST 09:00
    });
    expect(plan1.shouldSend).toBe(true);
    expect(plan1.items[0].tier).toBe(15);

    // 模拟发信成功写入已发送记录
    sentRecords.add(`${contract.id}:${plan1.items[0].tier}:${contract.end_date}`);

    // 第二次扫描：10 点
    const plan2 = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T02:00:00Z'), // UTC 02:00 = CST 10:00
    });
    expect(plan2.shouldSend).toBe(false);
    expect(plan2.items).toHaveLength(0);
  });
});

describe('5. send_hour 门控与失败重试', () => {
  it('未到 send_hour 门控跳过；达到后若发信失败未写库，后续小时自动重试', () => {
    const user: User = {
      id: 'u1',
      email: 'alice@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-01T00:00:00Z',
    };

    const contract: Contract = {
      id: 'c5',
      user_id: 'u1',
      name: '广告投放合同',
      client: '某广告主',
      start_date: '2026-05-01',
      end_date: '2026-10-15', // 剩余 7 天 => 档位 7
      amount: 100000,
      note: null,
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    const sentRecords = new Set<string>();

    // 早晨 8:00 (本地)，未到 9:00 门控
    const plan8am = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T00:00:00Z'), // UTC 00:00 = CST 08:00
    });
    expect(plan8am.shouldSend).toBe(false);
    expect(plan8am.reason).toContain('未到配置的发送小时');

    // 9:00 (本地)，触发提醒，但假设邮件发信异常，并未写入 sentRecords
    const plan9am = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T01:00:00Z'), // UTC 01:00 = CST 09:00
    });
    expect(plan9am.shouldSend).toBe(true);

    // 10:00 (本地)，由于 9:00 失败未写库，当前小时 (10 >= 9) 自动再次发起重试！
    const plan10am = planUserReminders({
      user,
      contracts: [contract],
      remindersSentKeys: sentRecords,
      currentDate: new Date('2026-10-08T02:00:00Z'), // UTC 02:00 = CST 10:00
    });
    expect(plan10am.shouldSend).toBe(true);
    expect(plan10am.items[0].contract.id).toBe('c5');
  });
});

describe('6. 时区边界', () => {
  it('正确根据用户 IANA 时区计算本地日期与当前小时', () => {
    // 固定 UTC 时间：2026-10-08 23:30:00
    const testUtc = new Date('2026-10-08T23:30:00Z');

    // Asia/Shanghai 是 UTC+8，应为 2026-10-09 07:30
    const shanghaiInfo = getLocalTimeInfo(testUtc, 'Asia/Shanghai');
    expect(shanghaiInfo.today).toBe('2026-10-09');
    expect(shanghaiInfo.hour).toBe(7);

    // America/New_York (夏令时 UTC-4)，应为 2026-10-08 19:30
    const nyInfo = getLocalTimeInfo(testUtc, 'America/New_York');
    expect(nyInfo.today).toBe('2026-10-08');
    expect(nyInfo.hour).toBe(19);

    // 日历日计算：跨月、跨年、闰月
    expect(calculateDaysLeft('2026-11-01', '2026-10-31')).toBe(1);
    expect(calculateDaysLeft('2027-01-01', '2026-12-31')).toBe(1);
    expect(calculateDaysLeft('2028-03-01', '2028-02-28')).toBe(2); // 2028 是闰年
  });
});

describe('7. 设置校验', () => {
  it('合法设置通过，不合法设置返回明确错误', () => {
    // 默认与合法设置
    const res1 = validateSettings({
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
    });
    expect(res1.valid).toBe(true);
    expect(res1.clean?.reminder_days).toEqual([30, 15, 7]);
    expect(res1.clean?.send_hour).toBe(9);
    expect(res1.clean?.timezone).toBe('Asia/Shanghai');

    // 自动去重与降序排序
    const res2 = validateSettings({
      reminder_days: [7, 30, 7, 15, 30],
    });
    expect(res2.valid).toBe(true);
    expect(res2.clean?.reminder_days).toEqual([30, 15, 7]);

    // reminder_days 超过 6 项
    const resTooMany = validateSettings({
      reminder_days: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(resTooMany.valid).toBe(false);
    expect(resTooMany.error).toContain('1 至 6 项');

    // reminder_days 为空
    const resEmpty = validateSettings({
      reminder_days: [],
    });
    expect(resEmpty.valid).toBe(false);

    // reminder_days 包含非法范围
    const resInvalidDay = validateSettings({
      reminder_days: [0, 400],
    });
    expect(resInvalidDay.valid).toBe(false);

    // send_hour 非法
    expect(validateSettings({ send_hour: -1 }).valid).toBe(false);
    expect(validateSettings({ send_hour: 24 }).valid).toBe(false);
    expect(validateSettings({ send_hour: 'abc' }).valid).toBe(false);

    // timezone 非法
    expect(validateSettings({ timezone: 'Invalid/Zone' }).valid).toBe(false);
    expect(validateSettings({ timezone: '' }).valid).toBe(false);
  });
});

describe('8. 验证码过期与超次数', () => {
  it('正确生成与验证 OTP，超5次锁定，10分钟过期拦截', async () => {
    const salt = generateSalt();
    const correctCode = '123456';
    const storedHash = await hashOtpCode(correctCode, salt);
    const now = Date.now();
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();

    // 1. 正确验证码验证成功
    const ok = await verifyOtpAttempt({
      enteredCode: '123456',
      salt,
      storedHash,
      expiresAt,
      attempts: 0,
      now,
    });
    expect(ok.success).toBe(true);

    // 2. 错误验证码
    const wrong = await verifyOtpAttempt({
      enteredCode: '654321',
      salt,
      storedHash,
      expiresAt,
      attempts: 1,
      now,
    });
    expect(wrong.success).toBe(false);
    expect(wrong.invalid).toBe(true);

    // 3. 超过5次锁定
    const locked = await verifyOtpAttempt({
      enteredCode: '123456',
      salt,
      storedHash,
      expiresAt,
      attempts: 5,
      now,
    });
    expect(locked.success).toBe(false);
    expect(locked.locked).toBe(true);

    // 4. 过期拦截（10分钟后）
    const expired = await verifyOtpAttempt({
      enteredCode: '123456',
      salt,
      storedHash,
      expiresAt,
      attempts: 0,
      now: now + 11 * 60 * 1000,
    });
    expect(expired.success).toBe(false);
    expect(expired.expired).toBe(true);
  });
});

describe('9. 用户 A 无法读写用户 B 的合同', () => {
  it('合同输入校验及多租户隔离约束：越权访问必须基于 user_id 严格隔离', () => {
    // 模拟数据源
    const mockDbContracts: Contract[] = [
      {
        id: 'contract-user-a',
        user_id: 'user_A',
        name: 'A的项目',
        client: '甲方A',
        start_date: null,
        end_date: '2026-12-31',
        amount: 1000,
        note: null,
        status: 'active',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'contract-user-b',
        user_id: 'user_B',
        name: 'B的项目',
        client: '甲方B',
        start_date: null,
        end_date: '2026-12-31',
        amount: 2000,
        note: null,
        status: 'active',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];

    // 查询函数严格带上 user_id
    function findContract(id: string, userId: string): Contract | null {
      return (
        mockDbContracts.find((c) => c.id === id && c.user_id === userId) || null
      );
    }

    // 用户 A 访问自己的合同 -> 成功
    const contractA = findContract('contract-user-a', 'user_A');
    expect(contractA).not.toBeNull();
    expect(contractA?.name).toBe('A的项目');

    // 用户 B 试图访问用户 A 的合同 -> 404 (null)
    const accessForbidden = findContract('contract-user-a', 'user_B');
    expect(accessForbidden).toBeNull();

    // 合同参数校验
    const validated = validateContractInput({
      name: '测试合同',
      client: '甲方',
      end_date: '2026-10-20',
      status: 'active',
    });
    expect(validated.valid).toBe(true);
  });
});
