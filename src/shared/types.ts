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
  images: string[];
  model?: string;
  prompt?: string;
}

