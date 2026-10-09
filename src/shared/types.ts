export type ContractStatus = 'active' | 'renewed' | 'terminated';

export interface User {
  id: string;
  email: string;
  reminder_days: number[];
  send_hour: number;
  timezone: string;
  created_at: string;
  ai_api_key?: string | null;
  ai_base_url?: string | null;
  ai_model?: string | null;
  ai_text_model?: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  reminder_days: string; // JSON string
  send_hour: number;
  timezone: string;
  created_at: string;
  ai_api_key?: string | null;
  ai_base_url?: string | null;
  ai_model?: string | null;
  ai_text_model?: string | null;
}

export interface Contract {
  id: string;
  user_id: string;
  name: string;
  client: string;
  start_date: string | null;
  end_date: string;
  amount: number | null;
  note: string | null;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
}

export interface ContractInput {
  name: string;
  client: string;
  start_date?: string | null;
  end_date: string;
  amount?: number | null;
  note?: string | null;
  status?: ContractStatus;
}

export interface Session {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

export interface OtpCode {
  id: string;
  email: string;
  salt: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

export interface ReminderSent {
  contract_id: string;
  tier: number;
  end_date: string;
  sent_at: string;
}

export interface RateLimit {
  key: string;
  window_start: number;
  count: number;
}

export interface UserSettings {
  reminder_days: number[];
  send_hour: number;
  timezone: string;
  ai_api_key?: string | null;
  ai_base_url?: string | null;
  ai_model?: string | null;
  ai_text_model?: string | null;
}

export interface PendingReminderItem {
  contract: Contract;
  tier: number;
  days_left: number;
}

export interface SettingsResponse {
  settings: UserSettings;
}

export interface CfAiModelOption {
  id: string;
  name: string;
  badge: string;
  costRank: number; // 性价比排名: 1 为最高
  pricingDesc: string;
  features: string;
  isDefault?: boolean;
}

/**
 * Cloudflare Workers AI 视觉模型列表，按性价比从高到低排列
 */
export const CF_AI_VISION_MODELS: CfAiModelOption[] = [
  {
    id: '@cf/meta/llama-3.2-11b-vision-instruct',
    name: 'Llama 3.2 11B Vision (推荐)',
    badge: '性价比之王',
    costRank: 1,
    pricingDesc: '输入 $0.049 / 1M tokens',
    features: '极低成本，11B 高精度参数，128k 上下文，支持多页合同长图综合识别',
    isDefault: true,
  },
  {
    id: '@cf/moondream/moondream3.1-9B-A2B',
    name: 'Moondream 3.1 (9B-A2B)',
    badge: '轻量高性价比',
    costRank: 2,
    pricingDesc: '微型视觉模型，极低神经元消耗',
    features: '专精视觉图文解析，响应极快，消耗轻巧',
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B',
    badge: '高精度旗舰',
    costRank: 3,
    pricingDesc: '输入 $0.27 / 1M tokens',
    features: 'Meta 新一代高精度多模态，复杂长条款与模糊印章推理能力极强',
  },
  {
    id: '@cf/llava-hf/llava-1.5-7b-hf',
    name: 'LLaVA 1.5 7B',
    badge: '开源轻量',
    costRank: 4,
    pricingDesc: '开源多模态，标准神经元开销',
    features: '经典开源视觉多模态大模型，适合标准合同快速扫描提取',
  },
];

/**
 * Cloudflare Workers AI 纯文本模型列表，按中文理解能力与性价比排列
 */
export const CF_AI_TEXT_MODELS: CfAiModelOption[] = [
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B (推荐)',
    badge: '中文提取之王',
    costRank: 1,
    pricingDesc: '通义千问 32B 参数，性价比极高',
    features: '超强中文与结构化 JSON 理解提取能力，响应极快，无需额外授权',
    isDefault: true,
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B Fast',
    badge: '70B 旗舰大模型',
    costRank: 2,
    pricingDesc: '输入 $0.15 / 1M tokens',
    features: 'Meta 旗舰级 70B 强推理模型，复杂合同长文本语义解析与法律条款归纳精准',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fp8',
    name: 'Llama 3.1 8B Instruct',
    badge: '轻量极速',
    costRank: 3,
    pricingDesc: '输入 $0.027 / 1M tokens',
    features: '极致轻量与超低延迟，适合日常简短合同文本秒级提取',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill 32B',
    badge: '深度推理审计',
    costRank: 4,
    pricingDesc: '深度思考模型，标准神经元开销',
    features: '具备多步逻辑推导链，适合条款晦涩、起止日模糊的深度审计',
  },
];

export interface ContractRecognizeResult {
  name?: string;
  client?: string;
  start_date?: string | null;
  end_date?: string;
  amount?: number | null;
  note?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  summary?: string;
  is_mock?: boolean;
  model_used?: string;
}

export interface ContractRecognizeRequest {
  images?: string[];
  text?: string;
  model?: string;
  prompt?: string;
}

