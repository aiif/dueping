import { describe, it, expect } from 'vitest';
import {
  parseContractRecognitionJson,
  normalizeDateString,
  normalizeAmount,
  validateSettings,
} from '../src/shared/logic';
import { recognizeContract } from '../src/worker/recognition';
import { User } from '../src/shared/types';

describe('10. 合同 AI 识别逻辑与数据规范化', () => {
  it('正确解析标准的 JSON 识别输出', () => {
    const raw = JSON.stringify({
      name: '2026年企业级云计算服务框架协议',
      client: '腾讯云计算（北京）有限责任公司',
      start_date: '2026-03-01',
      end_date: '2027-02-28',
      amount: 280000,
      note: '每季度结算一次，到期前60天确认续签',
      summary: '云计算基础设施及运维协议',
    });

    const res = parseContractRecognitionJson(raw);
    expect(res.name).toBe('2026年企业级云计算服务框架协议');
    expect(res.client).toBe('腾讯云计算（北京）有限责任公司');
    expect(res.start_date).toBe('2026-03-01');
    expect(res.end_date).toBe('2027-02-28');
    expect(res.amount).toBe(280000);
    expect(res.note).toBe('每季度结算一次，到期前60天确认续签');
    expect(res.confidence).toBe('high');
  });

  it('能容错解析被 Markdown ```json 代码块包裹的大模型输出', () => {
    const raw = `
这是我为您分析的合同内容：
\`\`\`json
{
  "name": "办公楼租赁合同",
  "client": "上海陆家嘴商业地产开发有限公司",
  "start_date": "2026-01-01",
  "end_date": "2028-12-31",
  "amount": "120万元",
  "note": "押二付三，到期需提前30天书面通知是否退租"
}
\`\`\`
请您核对！`;

    const res = parseContractRecognitionJson(raw);
    expect(res.name).toBe('办公楼租赁合同');
    expect(res.client).toBe('上海陆家嘴商业地产开发有限公司');
    expect(res.start_date).toBe('2026-01-01');
    expect(res.end_date).toBe('2028-12-31');
    expect(res.amount).toBe(1200000); // 120万元 -> 1200000
    expect(res.confidence).toBe('high');
  });

  it('日期格式多模态规范化', () => {
    expect(normalizeDateString('2026-10-15')).toBe('2026-10-15');
    expect(normalizeDateString('2026/10/15')).toBe('2026-10-15');
    expect(normalizeDateString('2026.10.15')).toBe('2026-10-15');
    expect(normalizeDateString('2026年10月15日')).toBe('2026-10-15');
    expect(normalizeDateString('2026年5月9日')).toBe('2026-05-09');
    expect(normalizeDateString('invalid-date')).toBeNull();
    expect(normalizeDateString(null)).toBeNull();
  });

  it('金额多模态规范化（去除符号、千分位及万元单位转换）', () => {
    expect(normalizeAmount(50000)).toBe(50000);
    expect(normalizeAmount('50000')).toBe(50000);
    expect(normalizeAmount('¥ 50,000.00')).toBe(50000);
    expect(normalizeAmount('￥128,500元')).toBe(128500);
    expect(normalizeAmount('30万元')).toBe(300000);
    expect(normalizeAmount('2.5万')).toBe(25000);
    expect(normalizeAmount('待定')).toBeNull();
  });

  it('畸形响应容错：当 AI 返回非 JSON 文本时，平稳降级不崩溃', () => {
    const raw = '抱歉，图片太模糊，无法看清合同文字。';
    const res = parseContractRecognitionJson(raw);
    expect(res.confidence).toBe('low');
    expect(res.summary).toContain('解析失败');
  });

  it('AI 识别在空图片输入时抛出友好错误', async () => {
    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    await expect(
      recognizeContract({
        env: {} as any,
        user: fakeUser,
        images: [],
      })
    ).rejects.toThrow('请至少上传一张合同图片');
  });

  it('Mock / 演示模式平稳运行并返回结构化数据', async () => {
    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    const res = await recognizeContract({
      env: {} as any,
      user: fakeUser,
      images: ['data:image/jpeg;base64,ZmFrZQ=='],
    });

    expect(res.name).toBeDefined();
    expect(res.client).toBeDefined();
    expect(res.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.is_mock).toBe(true);
  });

  it('设置校验支持保存自定义 AI 配置字段', () => {
    const valid = validateSettings({
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      ai_api_key: 'sk-my-custom-key',
      ai_base_url: 'https://api.openai.com/v1',
      ai_model: 'gpt-4o',
    });

    expect(valid.valid).toBe(true);
    expect(valid.clean?.ai_api_key).toBe('sk-my-custom-key');
    expect(valid.clean?.ai_base_url).toBe('https://api.openai.com/v1');
    expect(valid.clean?.ai_model).toBe('gpt-4o');
  });
});
