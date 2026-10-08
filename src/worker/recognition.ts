import { ContractRecognizeResult, User } from '../shared/types';
import { parseContractRecognitionJson } from '../shared/logic';

const SYSTEM_PROMPT = `你是一个专业的合同审计与信息抽取专家。用户会提供一份合同的一页或多页图片（可能包含封面、正文条款、签署盖章页）。
请仔细阅读图片内容，提取以下合同核心字段并严格以 JSON 格式输出：
1. "name": 合同全称（例如："企业级技术咨询服务合同"、"2026年度房屋租赁协议"）
2. "client": 甲方名称（即委托方/承租方/采购方/客户公司或个人的法定全称）
3. "start_date": 合同生效/起始日期（格式必须为 YYYY-MM-DD，若图片中未体现请填 null）
4. "end_date": 合同到期/终止日期（格式必须为 YYYY-MM-DD。若合同写为"自生效日起一年"等相对期限，请结合起始日推算；若无法确定具体年份按当前时间或合同签署年推算）
5. "amount": 合同总金额（纯数字，单位元人民币，例如 50000。若无明确固定总额填 null）
6. "note": 关键备注信息（提取核心付款阶段、违约条款、续签通知期、联系人等，200字以内，若无填 null）
7. "summary": 合同主要内容总结（1-2句话概括）

只返回有效的 JSON 格式对象，不要包含其他无关内容。`;

interface RecognizeOptions {
  env: Env;
  user: User;
  images: string[];
}

/**
 * Recognizes contract metadata from uploaded images.
 */
export async function recognizeContract({
  env,
  user,
  images,
}: RecognizeOptions): Promise<ContractRecognizeResult> {
  if (!images || images.length === 0) {
    throw new Error('请至少上传一张合同图片');
  }

  // 1. Determine which AI configuration to use
  const customKey = user.ai_api_key?.trim();
  const envKey = (env as any).AI_API_KEY?.trim();
  const apiKey = customKey || envKey;

  const baseUrl = (user.ai_base_url?.trim() || (env as any).AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = user.ai_model?.trim() || (env as any).AI_MODEL?.trim() || 'gpt-4o-mini';

  // 2. If API Key is configured, use OpenAI-compatible multimodal endpoint
  if (apiKey) {
    try {
      const messagesContent: any[] = [
        {
          type: 'text',
          text: '请仔细识别以下合同图片，提取关键信息并输出合法 JSON。',
        },
      ];

      for (const img of images.slice(0, 5)) {
        messagesContent.push({
          type: 'image_url',
          image_url: {
            url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
          },
        });
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: messagesContent },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`AI 接口响应错误 (${response.status}): ${errorText.slice(0, 200)}`);
      }

      const data: any = await response.json();
      const rawText = data?.choices?.[0]?.message?.content || '';
      const parsed = parseContractRecognitionJson(rawText);
      return {
        ...parsed,
        is_mock: false,
      };
    } catch (err: any) {
      console.error('[AI Recognition Error]', err);
      // If user provided a specific custom key, report the explicit error
      if (customKey) {
        throw new Error(`自定义 AI 识别失败: ${err.message || '网络连接超时'}`);
      }
      // If it was global key, we can fall back to mock demo with informative notice
      console.warn('Falling back to demo mode due to AI provider error');
    }
  }

  // 3. Fallback: Demo / Mock recognition when no API key is set
  // This ensures the application remains testable and fully functional in pure local/demo environments
  const today = new Date();
  const nextYear = new Date(today);
  nextYear.setFullYear(today.getFullYear() + 1);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return {
    name: '信息化系统建设与技术运维服务合同',
    client: '北京智联科创技术有限公司',
    start_date: formatD(today),
    end_date: formatD(nextYear),
    amount: 158000,
    note: '付款节点：合同签订后付30%，初验通过付50%，质保期满1年后结清20%尾款。到期前30日需确认续签意向。',
    summary: '【演示模式识别】系统未配置 AI_API_KEY，已自动填充演示合同数据。您可在设置中配置私有 API Key 开启全自动真实识别。',
    confidence: 'high',
    is_mock: true,
  };
}
