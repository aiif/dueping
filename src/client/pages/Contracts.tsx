import React, { useState, useEffect, useMemo } from 'react';
import { api, ApiError } from '../api';
import { Contract, ContractStatus, User } from '../../shared/types';
import { calculateDaysLeft, formatContractStatus } from '../../shared/logic';

interface ContractsProps {
  user: User;
}

export const Contracts: React.FC<ContractsProps> = ({ user }) => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & search
  const [statusFilter, setStatusFilter] = useState<'all' | ContractStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formStatus, setFormStatus] = useState<ContractStatus>('active');

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchContracts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/contracts');
      setContracts(res.contracts || []);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : '加载合同列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContracts();
  }, []);

  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const maxReminderTier = useMemo(() => {
    if (user.reminder_days && user.reminder_days.length > 0) {
      return Math.max(...user.reminder_days);
    }
    return 30;
  }, [user.reminder_days]);

  const openCreateModal = () => {
    setEditingContract(null);
    setFormName('');
    setFormClient('');
    setFormStartDate('');
    setFormEndDate('');
    setFormAmount('');
    setFormNote('');
    setFormStatus('active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (c: Contract) => {
    setEditingContract(c);
    setFormName(c.name);
    setFormClient(c.client);
    setFormStartDate(c.start_date || '');
    setFormEndDate(c.end_date);
    setFormAmount(c.amount !== null && c.amount !== undefined ? String(c.amount) : '');
    setFormNote(c.note || '');
    setFormStatus(c.status);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!formName.trim() || !formClient.trim() || !formEndDate) {
      setModalError('合同名称、甲方和到期日均为必填项');
      return;
    }

    // Rule: 标记"已续签"时必须填新到期日
    if (formStatus === 'renewed') {
      if (editingContract && formEndDate === editingContract.end_date) {
        setModalError('标记为"已续签"时，必须填写新的合同到期日');
        return;
      }
    }

    setModalLoading(true);

    const payload = {
      name: formName.trim(),
      client: formClient.trim(),
      start_date: formStartDate || null,
      end_date: formEndDate,
      amount: formAmount ? Number(formAmount) : null,
      note: formNote.trim() || null,
      status: formStatus,
    };

    try {
      if (editingContract) {
        await api.put(`/api/contracts/${editingContract.id}`, payload);
      } else {
        await api.post('/api/contracts', payload);
      }
      setIsModalOpen(false);
      fetchContracts();
    } catch (err: any) {
      setModalError(err instanceof ApiError ? err.message : '保存失败，请检查输入');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这份合同吗？删除后不可恢复。')) return;
    setDeletingId(id);
    try {
      await api.delete(`/api/contracts/${id}`);
      setContracts((list) => list.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchName = c.name.toLowerCase().includes(term);
        const matchClient = c.client.toLowerCase().includes(term);
        if (!matchName && !matchClient) return false;
      }
      return true;
    });
  }, [contracts, statusFilter, searchTerm]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">合同管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            实时监控合同到期状态，系统会在到期前 {user.reminder_days.join(' / ')} 天发送提醒
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-xs transition-colors space-x-2"
        >
          <span>+</span>
          <span>录入新合同</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Status Pills */}
        <div className="flex rounded-lg bg-gray-100 p-1 space-x-1 text-sm font-medium self-start sm:self-auto">
          {(['all', 'active', 'renewed', 'terminated'] as const).map((st) => {
            const labels = {
              all: '全部',
              active: '进行中',
              renewed: '已续签',
              terminated: '已终止',
            };
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-gray-900 shadow-xs font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {labels[st]}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="搜索合同名称或甲方..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="absolute left-3 top-2.5 text-gray-400 text-xs">🔍</span>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r-md">
          {error}
        </div>
      )}

      {/* Contract list table / cards */}
      <div className="mt-6">
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">正在加载合同数据...</div>
        ) : filteredContracts.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <span className="text-4xl block mb-2">📄</span>
            <h3 className="text-base font-semibold text-gray-900">暂无相关合同</h3>
            <p className="text-sm text-gray-500 mt-1">
              {searchTerm || statusFilter !== 'all'
                ? '没有符合当前筛选条件的合同'
                : '点击上方"录入新合同"开始添加您的第一份合同'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 font-medium">
                  <tr>
                    <th className="px-6 py-3.5">合同信息</th>
                    <th className="px-6 py-3.5">甲方</th>
                    <th className="px-6 py-3.5">到期日与剩余</th>
                    <th className="px-6 py-3.5">金额</th>
                    <th className="px-6 py-3.5">状态</th>
                    <th className="px-6 py-3.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredContracts.map((c) => {
                    const daysLeft = calculateDaysLeft(c.end_date, todayStr);
                    const isExpiredActive = daysLeft < 0 && c.status === 'active';
                    const isHighlighted =
                      !isExpiredActive &&
                      daysLeft >= 0 &&
                      daysLeft <= maxReminderTier &&
                      c.status === 'active';

                    let rowBgClass = 'hover:bg-gray-50 transition-colors';
                    if (isExpiredActive) {
                      rowBgClass = 'bg-red-50/50 hover:bg-red-50 transition-colors';
                    } else if (isHighlighted) {
                      rowBgClass = 'bg-amber-50/40 hover:bg-amber-50/60 transition-colors';
                    }

                    return (
                      <tr key={c.id} className={rowBgClass}>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-gray-900">{c.name}</div>
                          {c.note && (
                            <div className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={c.note}>
                              备注: {c.note}
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {c.client}
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-gray-900 font-mono text-sm">{c.end_date}</div>
                          {c.status === 'active' ? (
                            isExpiredActive ? (
                              <span className="inline-flex items-center px-2 py-0.5 mt-1 rounded text-xs font-bold bg-red-100 text-red-700">
                                已逾期 {Math.abs(daysLeft)} 天
                              </span>
                            ) : isHighlighted ? (
                              <span className="inline-flex items-center px-2 py-0.5 mt-1 rounded text-xs font-bold bg-amber-100 text-amber-800">
                                仅剩 {daysLeft} 天到期
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 mt-1 block">
                                剩余 {daysLeft} 天
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-gray-400 mt-1 block">
                              已结项
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-gray-700">
                          {c.amount !== null && c.amount !== undefined ? (
                            <span className="font-medium">¥{c.amount.toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                              c.status === 'active'
                                ? isExpiredActive
                                  ? 'bg-red-100 text-red-800 font-bold'
                                  : 'bg-green-100 text-green-800'
                                : c.status === 'renewed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {formatContractStatus(c.status)}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                          <button
                            onClick={() => openEditModal(c)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 hover:bg-blue-50 rounded transition-colors"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={deletingId === c.id}
                            className="text-xs font-medium text-red-600 hover:text-red-800 px-2 py-1 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-gray-100 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-5">
              <h2 className="text-lg font-bold text-gray-900">
                {editingContract ? '编辑合同' : '录入新合同'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-xs rounded-r-md">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveContract} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  合同名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="例如：2026 年度技术咨询服务合同"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  甲方名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="例如：北京某某科技有限公司"
                  value={formClient}
                  onChange={(e) => setFormClient(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    起始日 (可选)
                  </label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    到期日 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    合同金额 (¥ 可选)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="例如：50000"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    状态
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ContractStatus)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  >
                    <option value="active">进行中</option>
                    <option value="renewed">已续签</option>
                    <option value="terminated">已终止</option>
                  </select>
                </div>
              </div>

              {formStatus === 'renewed' && (
                <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 border border-blue-200">
                  💡 <strong>续签提示：</strong>标记为已续签时，请确认已填入新的到期日。保存后系统将自动重置该合同的历史已提醒记录。
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  备注 (可选)
                </label>
                <textarea
                  rows={2}
                  placeholder="结款条款、续签对接人联系方式等"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-xs"
                >
                  {modalLoading ? '保存中...' : '保存合同'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
