import { describe, it, expect } from 'vitest';
import {
  parseContractRecognitionJson,
  normalizeDateString,
  normalizeAmount,
  validateSettings,
} from '../src/shared/logic';
import { recognizeContract } from '../src/worker/recognition';
import { User, CF_AI_VISION_MODELS } from '../src/shared/types';

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

  it('优先调用 Cloudflare Workers AI 原生模型提取合同信息', async () => {
    let calledModel = '';
    let calledPrompt = '';

    const mockEnv = {
      AI: {
        run: async (model: string, input: any) => {
          calledModel = model;
          calledPrompt = input.prompt;
          return {
            response: JSON.stringify({
              name: 'Cloudflare原生算力服务合同',
              client: 'Cloudflare Inc.',
              start_date: '2026-05-01',
              end_date: '2027-04-30',
              amount: 88000,
              note: '由 Workers AI 原生多模态大模型提取',
            }),
          };
        },
      },
    };

    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    const res = await recognizeContract({
      env: mockEnv as any,
      user: fakeUser,
      images: ['data:image/jpeg;base64,ZmFrZQ=='],
    });

    expect(calledModel).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(res.name).toBe('Cloudflare原生算力服务合同');
    expect(res.client).toBe('Cloudflare Inc.');
    expect(res.start_date).toBe('2026-05-01');
    expect(res.end_date).toBe('2027-04-30');
    expect(res.amount).toBe(88000);
    expect(res.is_mock).toBe(false);
  });

  it('Cloudflare Workers AI 视觉模型列表按性价比从高到低严格排序', () => {
    expect(CF_AI_VISION_MODELS.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < CF_AI_VISION_MODELS.length - 1; i++) {
      expect(CF_AI_VISION_MODELS[i].costRank).toBeLessThan(CF_AI_VISION_MODELS[i + 1].costRank);
    }
    // 性价比第一名必须为默认的 Llama 3.2 11B Vision
    expect(CF_AI_VISION_MODELS[0].id).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(CF_AI_VISION_MODELS[0].badge).toContain('性价比');
  });

  it('用户可指定选择特定的 Cloudflare AI 视觉模型', async () => {
    let calledModel = '';
    const mockEnv = {
      AI: {
        run: async (model: string) => {
          calledModel = model;
          return {
            response: JSON.stringify({
              name: '测试特定模型合同',
              client: '测试甲方',
              end_date: '2027-01-01',
            }),
          };
        },
      },
    };

    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    const res = await recognizeContract({
      env: mockEnv as any,
      user: fakeUser,
      images: ['data:image/jpeg;base64,ZmFrZQ=='],
      model: '@cf/moondream/moondream3.1-9B-A2B',
    });

    expect(calledModel).toBe('@cf/moondream/moondream3.1-9B-A2B');
    expect(res.model_used).toBe('@cf/moondream/moondream3.1-9B-A2B');
    expect(res.name).toBe('测试特定模型合同');
  });

  it('支持上传多张合同图片并合并审阅', async () => {
    let capturedOptions: any = null;
    const mockEnv = {
      AI: {
        run: async (model: string, options: any) => {
          capturedOptions = options;
          return {
            response: JSON.stringify({
              name: '多页服务总合同',
              client: '北京多元科技股份有限公司',
              start_date: '2026-06-01',
              end_date: '2028-05-31',
              amount: 520000,
              note: '共两页合同，包含第一页条款和第二页签署盖章',
            }),
          };
        },
      },
    };

    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    const res = await recognizeContract({
      env: mockEnv as any,
      user: fakeUser,
      images: [
        'data:image/jpeg;base64,ZmFrZVBhZ2Ux',
        'data:image/jpeg;base64,ZmFrZVBhZ2Uy',
      ],
      model: '@cf/meta/llama-3.2-11b-vision-instruct',
    });

    expect(res.name).toBe('多页服务总合同');
    expect(res.amount).toBe(520000);
    expect(res.is_mock).toBe(false);
    expect(capturedOptions.messages).toBeDefined();
    // 包含文字提示与2张图片的 image_url
    const userContent = capturedOptions.messages[1].content;
    const imageUrls = userContent.filter((c: any) => c.type === 'image_url');
    expect(imageUrls.length).toBe(2);
  });

  it('支持直接输入合同文本进行 AI 提取识别', async () => {
    let capturedOptions: any = null;
    const mockEnv = {
      AI: {
        run: async (model: string, options: any) => {
          capturedOptions = options;
          return {
            response: JSON.stringify({
              name: 'SaaS云平台年度订阅技术合同',
              client: '杭州未来互联科技有限公司',
              start_date: '2026-07-01',
              end_date: '2027-06-30',
              amount: 99000,
              note: '支持合同文本直接粘入提取',
            }),
          };
        },
      },
    };

    const fakeUser: User = {
      id: 'u1',
      email: 'test@example.com',
      reminder_days: [30, 15, 7],
      send_hour: 9,
      timezone: 'Asia/Shanghai',
      created_at: new Date().toISOString(),
    };

    const rawContractText = `合同名称：SaaS云平台年度订阅技术合同\n甲方：杭州未来互联科技有限公司\n有效期：2026年7月1日至2027年6月30日\n费用：人民币99,000元整`;
    const res = await recognizeContract({
      env: mockEnv as any,
      user: fakeUser,
      text: rawContractText,
      model: '@cf/meta/llama-3.2-11b-vision-instruct',
    });

    expect(res.name).toBe('SaaS云平台年度订阅技术合同');
    expect(res.client).toBe('杭州未来互联科技有限公司');
    expect(res.amount).toBe(99000);
    expect(res.start_date).toBe('2026-07-01');
    expect(res.end_date).toBe('2027-06-30');
    expect(capturedOptions.messages).toBeDefined();
    expect(capturedOptions.messages[1].content).toContain(rawContractText);
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
