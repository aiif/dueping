export type ContractStatus = 'active' | 'renewed' | 'terminated';

export interface User {
  id: string;
  email: string;
  reminder_days: number[];
  send_hour: number;
  timezone: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  reminder_days: string; // JSON string
  send_hour: number;
  timezone: string;
  created_at: string;
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
}

export interface PendingReminderItem {
  contract: Contract;
  tier: number;
  days_left: number;
}

export interface SettingsResponse {
  settings: UserSettings;
}
