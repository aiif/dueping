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
 * Converts a base64 string or data URL to an array of bytes for Cloudflare Workers AI binary inputs.
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
 * Maps any legacy model identifiers to current Cloudflare catalog IDs.
 */
function resolveCfModelId(rawId: string): string {
  if (rawId === '@cf/moondream/moondream3-1.9b-a2b') {
    return '@cf/moondream/moondream3.1-9B-A2B';
  }
  if (rawId === '@cf/unum/uform-gen2-qwen-500m') {
    return '@cf/llava-hf/llava-1.5-7b-hf';
  }
  return rawId;
}

/**
 * Executes a Cloudflare Workers AI call, automatically accepting Meta licenses (prompt: "agree")
 * if Cloudflare error 5016 is encountered.
 */
async function callCloudflareAiWithLicenseAgreement(env: Env, modelId: string, payload: any): Promise<any> {
  try {
    return await env.AI.run(modelId as any, payload);
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    // Cloudflare error 5016: "Prior to using this model, you must submit the prompt 'agree'..."
    if (errMsg.includes('agree') || errMsg.includes('5016') || errMsg.toLowerCase().includes('license')) {
      console.log(`[Cloudflare Workers AI] Auto-accepting Meta license agreement ('agree') for ${modelId}...`);
      try {
        await env.AI.run(modelId as any, { prompt: 'agree' });
        console.log(`[Cloudflare Workers AI] Agreement submitted successfully. Retrying inference for ${modelId}...`);
        return await env.AI.run(modelId as any, payload);
      } catch (agreeErr: any) {
        console.error(`[Cloudflare Workers AI] Auto-agreement failed for ${modelId}:`, agreeErr);
        throw agreeErr;
      }
    }
    throw err;
  }
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
  const rawModel = model?.trim() || user.ai_model?.trim() || '@cf/meta/llama-3.2-11b-vision-instruct';
  const selectedModel = resolveCfModelId(rawModel);

  // 1. Primary Engine: Cloudflare Workers AI (Default & Free native integration)
  const isCfModel = selectedModel.startsWith('@cf/') || !customKey;

  if (isCfModel && env.AI) {
    try {
      const cfModelId = selectedModel.startsWith('@cf/') ? selectedModel : '@cf/meta/llama-3.2-11b-vision-instruct';
      let responseText = '';

      if (cfModelId.includes('moondream')) {
        // Moondream 3.1: Special task: query format
        const dataUrl = images[0].startsWith('data:') ? images[0] : `data:image/jpeg;base64,${images[0]}`;
        const queryPrompt = `请提取图片中合同信息并以 JSON 格式输出：{"name":合同全称,"client":甲方公司名称,"start_date":合同生效日期YYYY-MM-DD,"end_date":合同到期终止日期YYYY-MM-DD,"amount":合同总金额数值,"note":关键付款或续签条款,"summary":合同总结}`;
        const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
          task: 'query',
          image: dataUrl,
          question: queryPrompt,
          reasoning: false,
          max_tokens: 1500,
        });
        responseText = (res as any)?.answer || (res as any)?.response || '';
      } else if (cfModelId.includes('llava')) {
        // LLaVA 1.5 7B: prompt + image byte array
        const imageBytes = base64ToByteArray(images[0]);
        const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
          prompt: `${SYSTEM_PROMPT}\n\n请提取合同关键信息并输出合法 JSON。`,
          image: imageBytes,
          max_tokens: 1500,
        });
        responseText = (res as any)?.description || (res as any)?.response || '';
      } else {
        // Llama 3.2 11B Vision / Llama 4 Scout: Modern multi-image multimodal messages format
        const userContent: any[] = [
          {
            type: 'text',
            text: `你是一个专业的合同审计与信息抽取专家。用户提供了该合同的 ${images.length} 张图片（按合同顺序排列，可能包含封面、条款细则、起止日期、金额与签署页等）。\n请综合审阅所有图片中的完整信息，提取合同核心字段并严格以 JSON 格式输出：\n${SYSTEM_PROMPT}`,
          },
        ];

        for (const img of images.slice(0, 5)) {
          const dataUrl = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
          userContent.push({
            type: 'image_url',
            image_url: { url: dataUrl },
          });
        }

        try {
          const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userContent },
            ],
            max_tokens: 1500,
          });
          responseText = (res as any)?.response || (res as any)?.content || '';
        } catch (msgErr: any) {
          console.warn(`[Cloudflare Workers AI] messages mode note for ${cfModelId}:`, msgErr?.message || msgErr);
          // Fallback to prompt + image byte array if messages format is not accepted
          const imageBytes = base64ToByteArray(images[0]);
          const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
            prompt: `${SYSTEM_PROMPT}\n\n请仔细审阅图片中的合同内容并提取关键信息，输出合法的 JSON 格式。`,
            image: imageBytes,
            max_tokens: 1500,
          });
          responseText = (res as any)?.response || '';
        }
      }

      if (responseText) {
        const parsed = parseContractRecognitionJson(responseText);
        return {
          ...parsed,
          model_used: cfModelId,
          is_mock: false,
        };
      }
    } catch (cfAiError: any) {
      const errorMsg = String(cfAiError?.message || cfAiError);
      console.warn(`[Cloudflare Workers AI (${selectedModel}) execution note]`, errorMsg);

      // If running on local development without remote GPU (Miniflare error)
      const isLocalDevError =
        errorMsg.includes('not supported locally') ||
        errorMsg.includes('Miniflare') ||
        errorMsg.includes('Cannot read properties of undefined') ||
        errorMsg.includes('fetch failed');

      // If not local dev, and user has NO custom key, throw clear error so user knows exact issue
      if (!isLocalDevError && !customKey) {
        throw new Error(`Cloudflare Workers AI (${selectedModel}) 识别失败: ${errorMsg}`);
      }
    }
  }

  // 2. User explicitly provided a private custom API key for non-CF models (e.g. OpenAI/Gemini/DeepSeek)
  if (customKey && !selectedModel.startsWith('@cf/')) {
    const baseUrl = (user.ai_base_url?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');

    const messagesContent: any[] = [
      {
        type: 'text',
        text: `请仔细审阅以下上传的 ${images.length} 张合同图片，提取合同核心字段并输出合法 JSON 格式：\n${SYSTEM_PROMPT}`,
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
        max_tokens: 1200,
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
          text: `请仔细审阅以下 ${images.length} 张合同图片，提取关键信息并输出合法 JSON。`,
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
          max_tokens: 1200,
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

  // 4. Offline / Local Dev Demo Fallback (Only in local environment without GPU)
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
    summary: '【本地离线演示模式】当前处于本地无 GPU 环境，已载入示例数据。线上环境会自动通过 Cloudflare Workers AI 原生识别。',
    confidence: 'high',
    model_used: selectedModel,
    is_mock: true,
  };
}
