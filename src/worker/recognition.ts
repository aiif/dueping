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
  model?: string;
}

/**
 * Converts a base64 string or data URL to an array of bytes for Cloudflare Workers AI.
 */
function base64ToByteArray(base64Str: string): number[] {
  const commaIdx = base64Str.indexOf(',');
  const cleanBase64 = commaIdx !== -1 ? base64Str.slice(commaIdx + 1) : base64Str;
  const binaryString = atob(cleanBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return Array.from(bytes);
}

/**
 * Recognizes contract metadata from uploaded images.
 * Supports choosing from Cloudflare Workers AI models (ordered by cost-performance) or custom external models.
 */
export async function recognizeContract({
  env,
  user,
  images,
  model,
}: RecognizeOptions): Promise<ContractRecognizeResult> {
  if (!images || images.length === 0) {
    throw new Error('请至少上传一张合同图片');
  }

  const customKey = user.ai_api_key?.trim();
  // Selected model: preference order = single request param > user settings > default top cost-performance model
  const selectedModel = model?.trim() || user.ai_model?.trim() || '@cf/meta/llama-3.2-11b-vision-instruct';

  // 1. If requested model is a Cloudflare model OR no custom external key is set, use Cloudflare Workers AI
  const isCfModel = selectedModel.startsWith('@cf/') || !customKey;

  if (isCfModel && env.AI) {
    try {
      const cfModelId = selectedModel.startsWith('@cf/') ? selectedModel : '@cf/meta/llama-3.2-11b-vision-instruct';
      const imageBytes = base64ToByteArray(images[0]);
      const cfAiRes = await env.AI.run(cfModelId as any, {
        prompt: `${SYSTEM_PROMPT}\n\n请仔细审阅图片中的合同内容并提取关键信息，输出合法的 JSON 格式。`,
        image: imageBytes,
        max_tokens: 1024,
      });

      const responseText = (cfAiRes as any)?.response || '';
      if (responseText) {
        const parsed = parseContractRecognitionJson(responseText);
        return {
          ...parsed,
          model_used: cfModelId,
          is_mock: false,
        };
      }
    } catch (cfAiError: any) {
      console.warn(`[Cloudflare Workers AI (${selectedModel}) execution note]`, cfAiError?.message || cfAiError);
      // Miniflare in pure local dev mode without --remote cannot run remote GPU models locally
    }
  }

  // 2. If user explicitly provided a private custom API key for non-CF models (e.g. OpenAI/Gemini)
  if (customKey && !selectedModel.startsWith('@cf/')) {
    const baseUrl = (user.ai_base_url?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');

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
        Authorization: `Bearer ${customKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
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
      throw new Error(`外部 AI 接口响应错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const rawText = data?.choices?.[0]?.message?.content || '';
    const parsed = parseContractRecognitionJson(rawText);
    return {
      ...parsed,
      model_used: selectedModel,
      is_mock: false,
    };
  }

  // 3. Fallback: Global AI_API_KEY if configured in wrangler vars/secrets
  const envKey = (env as any).AI_API_KEY?.trim();
  if (envKey) {
    try {
      const baseUrl = ((env as any).AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const externalModel = (env as any).AI_MODEL?.trim() || 'gpt-4o-mini';

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
          Authorization: `Bearer ${envKey}`,
        },
        body: JSON.stringify({
          model: externalModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: messagesContent },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        const rawText = data?.choices?.[0]?.message?.content || '';
        const parsed = parseContractRecognitionJson(rawText);
        return {
          ...parsed,
          model_used: externalModel,
          is_mock: false,
        };
      }
    } catch (fallbackError) {
      console.warn('[Fallback API Error]', fallbackError);
    }
  }

  // 4. Offline / Local Dev Demo Fallback
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
    summary: '【Workers AI 演示模式】已自动填充示例数据。线上环境自动调用您选择的 Cloudflare Workers AI 原生模型。',
    confidence: 'high',
    model_used: selectedModel,
    is_mock: true,
  };
}
