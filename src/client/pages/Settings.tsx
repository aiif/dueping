import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { User, UserSettings, SettingsResponse } from '../../shared/types';
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

    const candidateSettings = {
      reminder_days: rawDays,
      send_hour: Number(sendHour),
      timezone: activeTimezone,
    };

    const validation = validateSettings(candidateSettings);
    if (!validation.valid || !validation.clean) {
      setSaveError(validation.error || '设置校验失败');
      return;
    }

    setSaveLoading(true);
    try {
      const res = await api.put<SettingsResponse>('/api/settings', validation.clean);
      setSaveSuccess('提醒设置已成功更新！');
      setReminderDaysInput(res.settings.reminder_days.join(', '));
      setSendHour(res.settings.send_hour);
      setTimezone(res.settings.timezone);

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
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">提醒设置</h1>
        <p className="mt-1 text-sm text-gray-500">
          配置合同到期提醒的天数档位、每日发送时段与所在时区。
        </p>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-xs divide-y divide-gray-100">
        <div className="p-6 space-y-6">
          {saveSuccess && (
            <div className="p-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex items-center space-x-2">
              <span className="text-lg">✓</span>
              <span>{saveSuccess}</span>
            </div>
          )}

          {saveError && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center space-x-2">
              <span className="text-lg">⚠</span>
              <span>{saveError}</span>
            </div>
          )}

          {/* Reminder Days */}
          <div>
            <label className="block text-sm font-semibold text-gray-900">
              提醒天数档位 (reminder_days)
            </label>
            <p className="text-xs text-gray-500 mt-0.5">
              合同到期前触发提醒的天数。支持 1–6 个整数（范围 1–365），用逗号分隔，系统将自动降序排列。
            </p>
            <div className="mt-2">
              <input
                type="text"
                value={reminderDaysInput}
                onChange={(e) => setReminderDaysInput(e.target.value)}
                placeholder="例如: 30, 15, 7"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
            </div>
            {/* Quick Presets */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">常用预设:</span>
              <button
                type="button"
                onClick={() => applyPreset([30, 15, 7])}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
              >
                标准 (30, 15, 7)
              </button>
              <button
                type="button"
                onClick={() => applyPreset([60, 30, 15, 7])}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
              >
                提前两月 (60, 30, 15, 7)
              </button>
              <button
                type="button"
                onClick={() => applyPreset([14, 7, 3, 1])}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
              >
                短周期 (14, 7, 3, 1)
              </button>
            </div>
          </div>

          {/* Send Hour */}
          <div>
            <label className="block text-sm font-semibold text-gray-900">
              每日提醒发送时间 (send_hour)
            </label>
            <p className="text-xs text-gray-500 mt-0.5">
              到达该小时整点或之后将触发当日邮件检查（若该小时系统调度波动，后续小时将自动补发）。
            </p>
            <div className="mt-2 max-w-xs">
              <select
                value={sendHour}
                onChange={(e) => setSendHour(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00 {i === 9 ? '（推荐 - 上午 9 点）' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-semibold text-gray-900">
              所在时区 (timezone)
            </label>
            <p className="text-xs text-gray-500 mt-0.5">
              必须为有效的 IANA 时区标识，用于精准计算“今天”及发送小时。
            </p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
              <div>
                <select
                  value={
                    COMMON_TIMEZONES.some((tz) => tz.value === timezone) && !customTimezone
                      ? timezone
                      : 'custom'
                  }
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setCustomTimezone(timezone);
                    } else {
                      setTimezone(e.target.value);
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
              <span>保存提醒配置</span>
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
