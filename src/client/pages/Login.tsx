import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { User } from '../../shared/types';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');

  // Cooldown countdown for 60s
  const [cooldown, setCooldown] = useState(0);

  const [requestLoading, setRequestLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('请输入正确的邮箱地址');
      return;
    }

    setRequestLoading(true);
    try {
      const res = await api.post('/api/auth/otp/request', { email: cleanEmail });
      setInfoMessage(res.message || '验证码已发送至您的邮箱');
      setStep('code');
      setCooldown(60); // 60s cooldown
    } catch (err: any) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('发送验证码失败，请稍后重试');
      }
    } finally {
      setRequestLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    if (!cleanCode || cleanCode.length !== 6) {
      setErrorMessage('请输入完整的 6 位数字验证码');
      return;
    }

    setVerifyLoading(true);
    try {
      const res = await api.post('/api/auth/otp/verify', {
        email: cleanEmail,
        code: cleanCode,
      });
      if (res.user) {
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('验证失败，请检查验证码或稍后重试');
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-md w-full space-y-8 bg-white p-8 sm:p-10 rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 text-3xl mb-4 shadow-inner">
            🔔
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            dueping 合同到期提醒
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            超轻量合同管理，提前发送邮件提醒您确认续签与结款
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r-md">
            {errorMessage}
          </div>
        )}

        {infoMessage && (
          <div className="p-3 bg-green-50 border-l-4 border-green-500 text-green-700 text-sm rounded-r-md">
            {infoMessage}
          </div>
        )}

        <form onSubmit={step === 'email' ? handleRequestOtp : handleVerifyOtp} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              工作或个人邮箱
            </label>
            <input
              id="email"
              type="email"
              required
              disabled={step === 'code' && cooldown > 0}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-hidden text-gray-900 text-sm transition-all"
            />
          </div>

          {step === 'code' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                  6 位数字验证码
                </label>
                <button
                  type="button"
                  onClick={() => setStep('email')}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  修改邮箱
                </button>
              </div>
              <input
                id="code"
                type="text"
                maxLength={6}
                autoFocus
                placeholder="6 位数字"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-hidden text-center text-xl tracking-widest font-mono text-gray-900 transition-all"
              />
              <p className="mt-1.5 text-xs text-gray-400 text-center">
                验证码 10 分钟内有效，首次登录将自动为您开通账号
              </p>
            </div>
          )}

          {step === 'email' ? (
            <button
              type="submit"
              disabled={requestLoading || !email.trim()}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors shadow-xs flex items-center justify-center space-x-2"
            >
              {requestLoading ? (
                <span>正在发送验证码...</span>
              ) : (
                <span>获取邮箱验证码</span>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <button
                type="submit"
                disabled={verifyLoading || code.length !== 6}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors shadow-xs flex items-center justify-center space-x-2"
              >
                {verifyLoading ? (
                  <span>正在登录...</span>
                ) : (
                  <span>登 录</span>
                )}
              </button>

              <button
                type="button"
                disabled={cooldown > 0 || requestLoading}
                onClick={() => handleRequestOtp()}
                className="w-full py-2 px-4 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium rounded-lg text-xs transition-colors"
              >
                {cooldown > 0 ? `重新获取验证码 (${cooldown}s)` : '重新发送验证码'}
              </button>
            </div>
          )}
        </form>

        <div className="pt-4 border-t border-gray-100 text-center text-xs text-gray-400">
          无需输入密码 · 基于 Cloudflare Workers &amp; D1 构建
        </div>
      </div>
    </div>
  );
};
