import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { User, SettingsResponse, CF_AI_VISION_MODELS } from '../../shared/types';
import { validateSettings, getLocalTimeInfo } from '../../shared/logic';

interface SettingsProps {
  user: User;
  onUserUpdate?: (updatedUser: User) => void;
}

const COMMON_TIMEZONES = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (北京时间, UTC+8)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (香港时间, UTC+8)' },
  { value: 'Asia/Taipei', label: 'Asia/Taipei (台北时间, UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (东京时间, UTC+9)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (新加坡时间, UTC+8)' },
  { value: 'UTC', label: 'UTC (世界协调时)' },
  { value: 'Europe/London', label: 'Europe/London (伦敦时间)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (巴黎时间)' },
  { value: 'America/New_York', label: 'America/New_York (纽约/美东时间)' },
  { value: 'America/Chicago', label: 'America/Chicago (芝加哥/美中时间)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (洛杉矶/美西时间)' },
];

export const Settings: React.FC<SettingsProps> = ({ user, onUserUpdate }) => {
  // Reminder days input as comma-separated string
  const [reminderDaysInput, setReminderDaysInput] = useState(
    user.reminder_days.join(', ')
  );
  const [sendHour, setSendHour] = useState(user.send_hour);
  const [timezone, setTimezone] = useState(user.timezone);
  const [customTimezone, setCustomTimezone] = useState(
    COMMON_TIMEZONES.some((tz) => tz.value === user.timezone) ? '' : user.timezone
  );

  // AI Configuration State
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState('');
  const [aiModelInput, setAiModelInput] = useState('');
  const [aiKeyConfigured, setAiKeyConfigured] = useState(false);
  const [aiKeyMasked, setAiKeyMasked] = useState('');

  // Status indicators
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailSuccess, setTestEmailSuccess] = useState<string | null>(null);
  const [testEmailError, setTestEmailError] = useState<string | null>(null);

  // Local time preview
  const [currentTimePreview, setCurrentTimePreview] = useState('');

  const activeTimezone = customTimezone.trim() || timezone;

  // Load server settings on mount
  useEffect(() => {
    api.get<any>('/api/settings').then((data) => {
      if (data) {
        if (data.ai_base_url) setAiBaseUrlInput(data.ai_base_url);
        if (data.ai_model) setAiModelInput(data.ai_model);
        if (data.ai_api_key_configured) {
          setAiKeyConfigured(true);
          setAiKeyMasked(data.ai_api_key_masked || '••••••••');
        }
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const now = new Date();
      const info = getLocalTimeInfo(now, activeTimezone);
      const hourStr = String(info.hour).padStart(2, '0');
      const minStr = String(now.toLocaleTimeString('en-US', { timeZone: activeTimezone, minute: '2-digit' }));
      setCurrentTimePreview(`${info.today} ${hourStr}:${minStr} (${activeTimezone})`);
    } catch {
      setCurrentTimePreview('无效的时区');
    }
  }, [activeTimezone]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    // Parse reminder days
    const rawDays = reminderDaysInput
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s));

    const candidateSettings: any = {
      reminder_days: rawDays,
      send_hour: Number(sendHour),
      timezone: activeTimezone,
      ai_base_url: aiBaseUrlInput.trim() || null,
      ai_model: aiModelInput.trim() || null,
    };

    if (aiApiKeyInput.trim()) {
      candidateSettings.ai_api_key = aiApiKeyInput.trim();
    }

    const validation = validateSettings(candidateSettings);
    if (!validation.valid || !validation.clean) {
      setSaveError(validation.error || '设置校验失败');
      return;
    }

    setSaveLoading(true);
    try {
      const res = await api.put<SettingsResponse>('/api/settings', validation.clean);
      setSaveSuccess('设置已成功更新！');
      setReminderDaysInput(res.settings.reminder_days.join(', '));
      setSendHour(res.settings.send_hour);
      setTimezone(res.settings.timezone);

      if (aiApiKeyInput.trim()) {
        setAiKeyConfigured(true);
        setAiKeyMasked('••••••••' + aiApiKeyInput.trim().slice(-4));
        setAiApiKeyInput('');
      }

      if (onUserUpdate) {
        onUserUpdate({
          ...user,
          reminder_days: res.settings.reminder_days,
          send_hour: res.settings.send_hour,
          timezone: res.settings.timezone,
        });
      }

      setTimeout(() => {
        setSaveSuccess(null);
      }, 4000);
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : '保存设置失败，请重试';
      setSaveError(message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearAiKey = async () => {
    if (!window.confirm('确认清除已保存的自定义 AI 密钥吗？清除后将回退使用系统预设配置。')) return;
    setSaveLoading(true);
    try {
      await api.put('/api/settings', {
        reminder_days: user.reminder_days,
        send_hour: user.send_hour,
        timezone: activeTimezone,
        ai_api_key: null,
      });
      setAiKeyConfigured(false);
      setAiKeyMasked('');
      setAiApiKeyInput('');
      setSaveSuccess('已清除自定义 AI 密钥');
    } catch {
      setSaveError('清除密钥失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    setTestEmailError(null);
    setTestEmailSuccess(null);
    setTestEmailLoading(true);

    try {
      const res = await api.post<{ success: boolean; message: string }>(
        '/api/settings/test-email'
      );
      setTestEmailSuccess(res.message || '测试邮件已发送，请检查收件箱（或垃圾箱）！');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : '发送测试邮件失败，请重试';
      setTestEmailError(message);
    } finally {
      setTestEmailLoading(false);
    }
  };

  const applyPreset = (preset: number[]) => {
    setReminderDaysInput(preset.join(', '));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">应用与提醒设置</h1>
        <p className="mt-1 text-sm text-gray-500">
          配置合同到期提醒的天数档位、每日发送时段、时区以及可选的 AI 视觉识别模型。
        </p>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        {saveSuccess && (
          <div className="p-4 bg-green-50 border-b border-green-200 text-green-700 text-sm flex items-center space-x-2">
            <span className="text-lg">✓</span>
            <span>{saveSuccess}</span>
          </div>
        )}

        {saveError && (
          <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-sm flex items-center space-x-2">
            <span className="text-lg">⚠</span>
            <span>{saveError}</span>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Reminder Days Field */}
          <div>
            <label className="block text-sm font-semibold text-gray-900">
              提前提醒天数（天）
            </label>
            <p className="mt-1 text-xs text-gray-500">
              用逗号分隔多个天数（1–365），去重后保留 1–6 项。例如当配置为 30, 15, 7 时，合同到期前 30、15、7 天将各触发一封提醒邮件。
            </p>
            <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                type="text"
                value={reminderDaysInput}
                onChange={(e) => setReminderDaysInput(e.target.value)}
                placeholder="例如: 30, 15, 7"
                className="w-full sm:max-w-md px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>快捷预设:</span>
                <button
                  type="button"
                  onClick={() => applyPreset([30, 15, 7])}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                >
                  30/15/7天 (默认)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset([60, 30, 15, 7])}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                >
                  60/30/15/7天
                </button>
              </div>
            </div>
          </div>

          {/* Send Hour Field */}
          <div className="pt-4 border-t border-gray-100">
            <label className="block text-sm font-semibold text-gray-900">
              每日提醒发送时段
            </label>
            <p className="mt-1 text-xs text-gray-500">
              按您的本地时区计算。系统在整点 Cron 触发时，若本地小时 ≥ 该设定值，便会检查并推送当天尚未发送的到期提醒汇总邮件。
            </p>
            <div className="mt-2 flex items-center space-x-3">
              <select
                value={sendHour}
                onChange={(e) => setSendHour(Number(e.target.value))}
                className="px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00 {i === 9 ? '(建议, 上午9点)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">
                每天上午 {String(sendHour).padStart(2, '0')}:00 开始扫描并投递邮件
              </span>
            </div>
          </div>

          {/* Timezone Field */}
          <div className="pt-4 border-t border-gray-100">
            <label className="block text-sm font-semibold text-gray-900">
              用户所在时区
            </label>
            <p className="mt-1 text-xs text-gray-500">
              用于准确计算每日日期边界与提醒小时。默认为中国标准时间 (Asia/Shanghai)。
            </p>
            <div className="mt-2 space-y-2 max-w-md">
              <div>
                <select
                  value={COMMON_TIMEZONES.some((tz) => tz.value === timezone) && !customTimezone ? timezone : 'custom'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setCustomTimezone(timezone);
                    } else {
                      setTimezone(val);
                      setCustomTimezone('');
                    }
                  }}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                  <option value="custom">其他自定义 IANA 时区...</option>
                </select>
              </div>

              {(!COMMON_TIMEZONES.some((tz) => tz.value === timezone) || customTimezone) && (
                <div>
                  <input
                    type="text"
                    value={customTimezone}
                    onChange={(e) => setCustomTimezone(e.target.value)}
                    placeholder="输入 IANA 时区，如 Asia/Seoul"
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Timezone preview */}
            <div className="mt-2 text-xs text-gray-500 flex items-center space-x-1.5">
              <span>🕒 当前时区本地换算时间:</span>
              <span className="font-mono font-medium text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                {currentTimePreview}
              </span>
            </div>
          </div>

          {/* AI Recognition Engine Settings */}
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <span>📸</span>
                  <span>AI 视觉识别引擎配置 (可选)</span>
                </label>
                <p className="mt-1 text-xs text-gray-500">
                  用于通过拍照或上传合同图片自动识别提取合同信息。系统已内置演示模式与系统默认配置，您亦可在此配置私有大模型 API。
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-3 max-w-lg">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  API 基础地址 (Base URL)
                </label>
                <input
                  type="text"
                  value={aiBaseUrlInput}
                  onChange={(e) => setAiBaseUrlInput(e.target.value)}
                  placeholder="留空则使用默认 (https://api.openai.com/v1)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-700">
                    API 密钥 (API Key)
                  </label>
                  {aiKeyConfigured && (
                    <button
                      type="button"
                      onClick={handleClearAiKey}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      清除当前密钥
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={aiApiKeyInput}
                  onChange={(e) => setAiApiKeyInput(e.target.value)}
                  placeholder={aiKeyConfigured ? `已配置 (${aiKeyMasked})，输入新密钥可覆盖` : 'sk-... (如留空则使用系统预设或演示模式)'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Cloudflare 原生视觉模型（按性价比从高到低排列）
                </label>
                <select
                  value={
                    CF_AI_VISION_MODELS.some((m) => m.id === aiModelInput)
                      ? aiModelInput
                      : aiModelInput
                      ? 'custom'
                      : CF_AI_VISION_MODELS[0].id
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setAiModelInput(aiModelInput.startsWith('@cf/') ? '' : aiModelInput);
                    } else {
                      setAiModelInput(val);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                >
                  {CF_AI_VISION_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      #{m.costRank} {m.name} [{m.badge}] - {m.pricingDesc}
                    </option>
                  ))}
                  <option value="custom">其他自定义外部模型 (如 gpt-4o-mini 等)...</option>
                </select>

                {/* Custom model input if user wants to use non-CF model */}
                {(!CF_AI_VISION_MODELS.some((m) => m.id === aiModelInput) && aiModelInput !== '') && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={aiModelInput}
                      onChange={(e) => setAiModelInput(e.target.value)}
                      placeholder="输入自定义模型名称，例如 gpt-4o-mini 或 qwen-vl-plus"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                    />
                  </div>
                )}

                {/* Model features note */}
                <div className="mt-1.5 text-xs text-indigo-700 bg-indigo-50/70 p-2 rounded-lg border border-indigo-100">
                  {(() => {
                    const currentModelId = aiModelInput || CF_AI_VISION_MODELS[0].id;
                    const matched = CF_AI_VISION_MODELS.find((m) => m.id === currentModelId);
                    if (matched) {
                      return (
                        <>
                          <span className="font-semibold text-indigo-900">{matched.badge}：</span>
                          {matched.features}（{matched.pricingDesc}）
                        </>
                      );
                    }
                    return '当前使用您指定的自定义外部模型。';
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="px-6 py-4 bg-gray-50/50 flex justify-end">
          <button
            type="submit"
            disabled={saveLoading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {saveLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>保存中...</span>
              </>
            ) : (
              <span>保存配置</span>
            )}
          </button>
        </div>
      </form>

      {/* Test Email Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">发送测试邮件</h2>
          <p className="mt-1 text-sm text-gray-500">
            向当前登录邮箱（<strong className="text-gray-700">{user.email}</strong>）发送一封测试提醒邮件，以确认发件服务与收件正常。
          </p>
        </div>

        {testEmailSuccess && (
          <div className="p-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex items-center space-x-2">
            <span className="text-lg">✓</span>
            <span>{testEmailSuccess}</span>
          </div>
        )}

        {testEmailError && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center space-x-2">
            <span className="text-lg">⚠</span>
            <span>{testEmailError}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg max-w-lg">
            ⚡ 频控限制：为保障邮件送达信用，每个用户每小时最多允许发送 3 次测试邮件。
          </div>

          <button
            type="button"
            onClick={handleSendTestEmail}
            disabled={testEmailLoading}
            className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-medium text-sm rounded-lg transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 shrink-0"
          >
            {testEmailLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>发送中...</span>
              </>
            ) : (
              <>
                <span>✉</span>
                <span>向我发送一封测试邮件</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Account Info */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">账号信息</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-gray-600">
          <div>
            <span className="text-gray-400 block">注册邮箱</span>
            <span className="font-mono text-gray-800 text-sm">{user.email}</span>
          </div>
          <div>
            <span className="text-gray-400 block">注册时间</span>
            <span className="text-gray-800 text-sm">{user.created_at || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
