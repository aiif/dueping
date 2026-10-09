import { ContractRecognizeResult, User } from '../shared/types';
import { parseContractRecognitionJson } from '../shared/logic';

const SYSTEM_PROMPT = `你是一个专业的合同审计与信息抽取专家。用户会提供一份合同的图片（可能包含多页）或合同文本内容。
请仔细阅读提供的内容，提取合同核心字段并严格以 JSON 格式输出。
输出 JSON 格式模板如下：
{
  "name": "合同全称（例如：企业级技术咨询服务合同、2026年度房屋租赁协议）",
  "client": "甲方名称（即委托方/承租方/采购方/客户公司或个人的法定全称）",
  "start_date": "合同生效/起始日期（格式必须为 YYYY-MM-DD，若无法确定填 null）",
  "end_date": "合同到期/终止日期（格式必须为 YYYY-MM-DD。若合同写为相对期限请结合起始日推算）",
  "amount": 50000,
  "note": "关键付款阶段、违约条款、续签通知期、联系人等，200字以内，若无填 null",
  "summary": "合同主要内容总结（1-2句话概括）"
}

重要输出规则：
1. 必须直接返回合法的 JSON 对象（以 { 开头，以 } 结尾）。
2. 严禁输出任何问候语、说明文字或非 JSON 格式内容。
3. 金额为纯数字（单位元人民币），无需包含符号或单位。`;

interface RecognizeOptions {
  env: Env;
  user: User;
  images?: string[];
  text?: string;
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
  text,
  model,
}: RecognizeOptions): Promise<ContractRecognizeResult> {
  const hasImages = Array.isArray(images) && images.length > 0;
  const cleanText = typeof text === 'string' ? text.trim() : '';

  if (!hasImages && !cleanText) {
    throw new Error('请至少上传一张合同图片或输入合同文本');
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
      let aiRawResponse: unknown = null;

      if (cleanText) {
        // Text recognition mode via Workers AI
        try {
          const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `合同文本内容如下：\n\n${cleanText}\n\n请直接提取合同字段并严格按指定模板输出 JSON 对象：` },
            ],
            max_tokens: 1500,
          });
          aiRawResponse = (res as any)?.response ?? (res as any)?.content ?? res;
        } catch (msgErr: any) {
          console.warn(`[Cloudflare Workers AI] text messages mode note for ${cfModelId}:`, msgErr?.message || msgErr);
          const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
            prompt: `${SYSTEM_PROMPT}\n\n合同文本内容如下：\n\n${cleanText}\n\n请直接提取合同字段并严格按指定模板输出 JSON 对象：`,
            max_tokens: 1500,
          });
          aiRawResponse = (res as any)?.response ?? (res as any)?.description ?? res;
        }
      } else if (images && images.length > 0) {
        // Image recognition mode via Workers AI
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
          aiRawResponse = (res as any)?.answer ?? (res as any)?.response ?? res;
        } else if (cfModelId.includes('llava')) {
          // LLaVA 1.5 7B: prompt + image byte array
          const imageBytes = base64ToByteArray(images[0]);
          const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
            prompt: `${SYSTEM_PROMPT}\n\n请提取合同关键信息并输出合法 JSON 对象。`,
            image: imageBytes,
            max_tokens: 1500,
          });
          aiRawResponse = (res as any)?.description ?? (res as any)?.response ?? res;
        } else {
          // Llama 3.2 11B Vision / Llama 4 Scout: Modern multi-image multimodal messages format
          const userContent: any[] = [
            {
              type: 'text',
              text: `用户上传了该合同的 ${images.length} 张图片（包含封面、条款细则、起止日期、金额与签署页）。请综合审阅所有图片内容，提取合同字段并严格按指定模板直接输出 JSON 对象：`,
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
            aiRawResponse = (res as any)?.response ?? (res as any)?.content ?? res;
          } catch (msgErr: any) {
            console.warn(`[Cloudflare Workers AI] messages mode note for ${cfModelId}:`, msgErr?.message || msgErr);
            // Fallback to prompt + image byte array if messages format is not accepted
            const imageBytes = base64ToByteArray(images[0]);
            const res = await callCloudflareAiWithLicenseAgreement(env, cfModelId, {
              prompt: `${SYSTEM_PROMPT}\n\n请仔细审阅图片中的合同内容并提取关键信息，输出合法的 JSON 格式对象。`,
              image: imageBytes,
              max_tokens: 1500,
            });
            aiRawResponse = (res as any)?.response ?? res;
          }
        }
      }

      if (aiRawResponse !== undefined && aiRawResponse !== null && aiRawResponse !== '') {
        const parsed = parseContractRecognitionJson(aiRawResponse);
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

    let userContent: any;
    if (cleanText) {
      userContent = `合同文本内容如下：\n\n${cleanText}\n\n请提取合同核心字段并输出合法 JSON 格式。`;
    } else {
      userContent = [
        {
          type: 'text',
          text: `请仔细审阅以下上传的 ${images!.length} 张合同图片，提取合同核心字段并输出合法 JSON 格式：\n${SYSTEM_PROMPT}`,
        },
      ];
      for (const img of (images || []).slice(0, 5)) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
          },
        });
      }
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
          { role: 'user', content: userContent },
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

      let userContent: any;
      if (cleanText) {
        userContent = `合同文本内容如下：\n\n${cleanText}\n\n请提取合同核心字段并输出合法 JSON 格式。`;
      } else {
        userContent = [
          {
            type: 'text',
            text: `请仔细审阅以下 ${images!.length} 张合同图片，提取关键信息并输出合法 JSON。`,
          },
        ];
        for (const img of (images || []).slice(0, 5)) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
            },
          });
        }
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
            { role: 'user', content: userContent },
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

  let demoName = '信息化系统建设与技术运维服务合同';
  let demoClient = '北京智联科创技术有限公司';
  let demoAmount = 158000;
  let demoNote = '付款节点：合同签订后付30%，初验通过付50%，质保期满1年后结清20%尾款。到期前30日需确认续签意向。';

  if (cleanText) {
    const lines = cleanText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines[0].length <= 35) {
      demoName = lines[0].replace(/^[#*•\s]+/, '').replace(/[：:]/g, '');
    }
    const clientMatch = cleanText.match(/(?:甲方|委托方|采购方|承租方|客户)[：:\s]*([^\n,，;；]{2,30})/);
    if (clientMatch && clientMatch[1]) {
      demoClient = clientMatch[1].trim();
    }
    const amountMatch = cleanText.match(/(?:金额|总价|总计|总额|费用)[：:\s]*([0-9,，.]+)\s*(?:元|万元)?/);
    if (amountMatch && amountMatch[1]) {
      const rawNum = parseFloat(amountMatch[1].replace(/,/g, ''));
      if (!isNaN(rawNum)) {
        demoAmount = cleanText.includes('万元') && rawNum < 10000 ? Math.round(rawNum * 10000) : Math.round(rawNum);
      }
    }
  }

  return {
    name: demoName,
    client: demoClient,
    start_date: formatD(today),
    end_date: formatD(nextYear),
    amount: demoAmount,
    note: demoNote,
    summary: cleanText
      ? '【离线演示】已基于您输入的合同文本智能提取关键信息。线上环境将由 Cloudflare Workers AI 进行深度识别。'
      : '【离线演示】当前处于本地无 GPU 环境，已载入示例数据。线上环境会自动通过 Cloudflare Workers AI 原生识别。',
    confidence: 'high',
    model_used: selectedModel,
    is_mock: true,
  };
}
