import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, ApiError } from '../api';
import { Contract, ContractStatus, User, ContractRecognizeResult, CF_AI_VISION_MODELS } from '../../shared/types';
import { calculateDaysLeft, formatContractStatus } from '../../shared/logic';

interface ContractsProps {
  user: User;
}

/**
 * Compresses an image file in browser using HTML5 Canvas.
 * Resizes maximum dimension to 1600px and outputs a JPEG base64 data URL.
 */
async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片文件失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('无法解析图片格式'));
      img.onload = () => {
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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

  // AI Recognition State
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [contractTextInput, setContractTextInput] = useState('');
  const [usedModelTag, setUsedModelTag] = useState<string | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionMsg, setRecognitionMsg] = useState<string | null>(null);
  const [isMockRecognize, setIsMockRecognize] = useState(false);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [showAiUploadSection, setShowAiUploadSection] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Hidden file inputs
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const openCreateModal = (preferAi = true, focusCamera = false) => {
    setEditingContract(null);
    setFormName('');
    setFormClient('');
    setFormStartDate('');
    setFormEndDate('');
    setFormAmount('');
    setFormNote('');
    setFormStatus('active');
    setModalError(null);
    setUploadedImages([]);
    setContractTextInput('');
    setIsRecognizing(false);
    setRecognitionMsg(null);
    setIsMockRecognize(false);
    setAiFilledFields(new Set());
    setShowAiUploadSection(preferAi);
    setIsModalOpen(true);

    if (focusCamera) {
      setTimeout(() => {
        cameraInputRef.current?.click();
      }, 200);
    }
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
    setUploadedImages([]);
    setContractTextInput('');
    setIsRecognizing(false);
    setRecognitionMsg(null);
    setIsMockRecognize(false);
    setAiFilledFields(new Set());
    setShowAiUploadSection(false); // Hide upload box by default when editing
    setIsModalOpen(true);
  };

  // Process chosen or dropped files
  const handleFilesSelected = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      alert('请选择有效的图片文件（JPG、PNG、WEBP 等）');
      return;
    }

    try {
      const compressedList = await Promise.all(imageFiles.map((file) => compressImageFile(file)));
      const combined = [...uploadedImages, ...compressedList].slice(0, 5);
      setUploadedImages(combined);
      setModalError(null);
      setRecognitionMsg(null);
      setIsMockRecognize(false);
    } catch (err: any) {
      setModalError('图片压缩处理失败，请重试');
    }
  };

  const removeUploadedImage = (index: number) => {
    const updated = uploadedImages.filter((_, i) => i !== index);
    setUploadedImages(updated);
    if (updated.length === 0) {
      setRecognitionMsg(null);
      setIsMockRecognize(false);
    }
  };

  const triggerAiRecognition = async (overrideMode?: 'image' | 'text') => {
    const mode = overrideMode || (uploadedImages.length > 0 ? 'image' : 'text');
    if (mode === 'image' && uploadedImages.length === 0) {
      setModalError('请先拍摄或上传合同图片');
      return;
    }
    if (mode === 'text' && !contractTextInput.trim()) {
      setModalError('请先输入或粘贴合同文本内容');
      return;
    }

    setIsRecognizing(true);
    setModalError(null);
    setRecognitionMsg(null);

    const targetModel = user.ai_model || CF_AI_VISION_MODELS[0].id;
    const payload: any = {
      model: targetModel,
    };
    if (mode === 'image') {
      payload.images = uploadedImages;
    } else {
      payload.text = contractTextInput.trim();
    }

    try {
      const res = await api.post<{ success: boolean; result: ContractRecognizeResult }>('/api/contracts/recognize', payload);

      const r = res.result;
      setUsedModelTag(r.model_used || targetModel);
      const filledSet = new Set<string>();

      if (r.name) {
        setFormName(r.name);
        filledSet.add('name');
      }
      if (r.client) {
        setFormClient(r.client);
        filledSet.add('client');
      }
      if (r.start_date) {
        setFormStartDate(r.start_date);
        filledSet.add('start_date');
      }
      if (r.end_date) {
        setFormEndDate(r.end_date);
        filledSet.add('end_date');
      }
      if (r.amount !== null && r.amount !== undefined) {
        setFormAmount(String(r.amount));
        filledSet.add('amount');
      }
      if (r.note) {
        setFormNote(r.note);
        filledSet.add('note');
      }

      setAiFilledFields(filledSet);
      setIsMockRecognize(Boolean(r.is_mock));
      setRecognitionMsg(r.summary || '已成功识别合同信息，请核对并确认');
    } catch (err: any) {
      setModalError(err instanceof ApiError ? err.message : '识别失败，请检查输入或重试');
    } finally {
      setIsRecognizing(false);
    }
  };

  // Paste image support
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!isModalOpen) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      handleFilesSelected(imageFiles);
    }
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8" onPaste={handlePaste}>
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">合同管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            实时监控合同到期状态，系统会在到期前 {user.reminder_days.join(' / ')} 天发送提醒
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => openCreateModal(true)}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg shadow-xs transition-colors space-x-1.5 cursor-pointer"
          >
            <span>🧠</span>
            <span>AI识别</span>
          </button>
          <button
            onClick={() => openCreateModal(false)}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-lg shadow-xs transition-colors space-x-1.5"
          >
            <span>+</span>
            <span>手动录入</span>
          </button>
        </div>
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
            <p className="text-sm text-gray-500 mt-1 mb-5">
              {searchTerm || statusFilter !== 'all'
                ? '没有符合当前筛选条件的合同'
                : '通过图片拍照或粘贴合同文本，AI 即可帮您秒级提取合同信息'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => openCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <span>🧠</span>
                <span>AI识别</span>
              </button>
              <button
                onClick={() => openCreateModal(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                + 手动录入
              </button>
            </div>
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-xl border border-gray-100 relative max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-100 mb-4 shrink-0">
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-gray-900">
                  {editingContract ? '编辑合同' : '录入合同'}
                </h2>
                {!editingContract && (
                  <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span>🧠</span>
                    <span>AI 识别填单</span>
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
              >
                &times;
              </button>
            </div>

            {/* Hidden native inputs for mobile camera and desktop file upload */}
            <input
              type="file"
              ref={cameraInputRef}
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />

            {/* Scrollable form body */}
            <div className="overflow-y-auto pr-1 space-y-4">
              {/* Expand AI Assistant Bar when collapsed */}
              {!showAiUploadSection && (
                <button
                  type="button"
                  onClick={() => setShowAiUploadSection(true)}
                  className="w-full py-2 px-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 text-indigo-700 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>🧠</span>
                  <span>展开 AI 智能识别 (文本 / 拍照 / 相册填表)</span>
                </button>
              )}

              {/* AI Recognition Section (Flat layout: 文本 -> 拍照 -> 相册) */}
              {showAiUploadSection && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleFilesSelected(e.dataTransfer.files);
                    }
                  }}
                  className={`rounded-xl border transition-colors p-3.5 space-y-3 ${
                    isDragging
                      ? 'border-indigo-500 bg-indigo-50/70'
                      : 'border-indigo-200/80 bg-indigo-50/25'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                      <span>🧠</span>
                      <span>AI 智能识别填单</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAiUploadSection(false)}
                      className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                      title="收起 AI 识别"
                    >
                      收起 ▲
                    </button>
                  </div>

                  {/* 1. 文本 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-700 flex items-center gap-1">
                        <span>📝</span>
                        <span>文本</span>
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        {contractTextInput && (
                          <button
                            type="button"
                            onClick={() => setContractTextInput('')}
                            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                          >
                            清空
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setContractTextInput(
                              '合同名称：2026年度企业技术咨询与运维保障协议\n甲方名称：北京智联科创技术有限公司\n合同期限：2026年3月1日至2027年2月28日\n合同金额：158,000元\n关键条款：签订后付30%，到期满1年结清尾款。需提前30天沟通续签。'
                            );
                          }}
                          className="text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                        >
                          示例文本
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <textarea
                        rows={2}
                        value={contractTextInput}
                        onChange={(e) => setContractTextInput(e.target.value)}
                        placeholder="粘贴或输入合同正文、关键条款摘要..."
                        className="w-full p-2.5 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-hidden placeholder-gray-400 leading-relaxed resize-y"
                      />
                    </div>

                    {contractTextInput.trim() && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => triggerAiRecognition('text')}
                          disabled={isRecognizing}
                          className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          {isRecognizing ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>识别中...</span>
                            </>
                          ) : (
                            <>
                              <span>✨</span>
                              <span>识别文本</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 2. 拍照 与 3. 相册 */}
                  <div className="space-y-2 pt-1 border-t border-indigo-100/70">
                    <div className="grid grid-cols-2 gap-2">
                      {/* 2. 拍照 */}
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="py-2.5 px-3 bg-white hover:bg-indigo-50/60 border border-gray-200 hover:border-indigo-300 rounded-lg text-xs font-medium text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer active:scale-98"
                      >
                        <span className="text-sm">📷</span>
                        <span>拍照</span>
                      </button>

                      {/* 3. 相册 */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-2.5 px-3 bg-white hover:bg-indigo-50/60 border border-gray-200 hover:border-indigo-300 rounded-lg text-xs font-medium text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer active:scale-98"
                      >
                        <span className="text-sm">🖼️</span>
                        <span>相册</span>
                      </button>
                    </div>

                    {/* 图片预览与识别（有已上传图片时显示） */}
                    {uploadedImages.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {uploadedImages.map((img, idx) => (
                            <div
                              key={idx}
                              className="relative group w-16 h-16 rounded-lg overflow-hidden border border-indigo-200 bg-gray-100 shadow-2xs"
                            >
                              <img src={img} alt={`合同第${idx + 1}页`} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removeUploadedImage(idx)}
                                className="absolute top-0.5 right-0.5 bg-black/70 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] transition-colors cursor-pointer"
                                title="删除此页"
                              >
                                &times;
                              </button>
                              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white text-center py-0.2 font-medium">
                                第 {idx + 1} 页
                              </span>
                            </div>
                          ))}

                          {uploadedImages.length < 5 && (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="w-16 h-16 rounded-lg border border-dashed border-gray-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/40 text-gray-400 hover:text-indigo-600 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors cursor-pointer"
                            >
                              <span className="text-sm">+</span>
                              <span>加选</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => triggerAiRecognition('image')}
                          disabled={isRecognizing}
                          className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-xs shadow-2xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
                        >
                          {isRecognizing ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>正在识别 {uploadedImages.length} 页图片...</span>
                            </>
                          ) : (
                            <>
                              <span>✨</span>
                              <span>识别已选图片 (共 {uploadedImages.length} 页)</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Recognition success prompt */}
                  {!isRecognizing && recognitionMsg && (
                    <div className="p-2.5 bg-green-50 text-green-800 text-xs rounded-lg border border-green-200">
                      <div className="flex items-center space-x-1.5 font-semibold">
                        <span>✨</span>
                        <span>AI 识别成功并自动填入表单</span>
                        {usedModelTag && (
                          <span className="ml-auto font-mono text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded border border-green-200 font-normal">
                            已用模型: {usedModelTag.replace('@cf/', '')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-green-700 text-[11px]">{recognitionMsg}</div>
                      {isMockRecognize && (
                        <div className="mt-1 text-amber-700 text-[11px] bg-amber-50 p-1.5 rounded border border-amber-200/60">
                          💡 提示：当前处于本地离线演示环境，已自动载入示例数据。线上生产环境由 Cloudflare Workers AI 进行真实识别。
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {modalError && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-xs rounded-r-md">
                  {modalError}
                </div>
              )}

              <form onSubmit={handleSaveContract} className="space-y-4 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      合同名称 <span className="text-red-500">*</span>
                    </label>
                    {aiFilledFields.has('name') && (
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                        ✨ AI已识别
                      </span>
                    )}
                  </div>
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      甲方名称 <span className="text-red-500">*</span>
                    </label>
                    {aiFilledFields.has('client') && (
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                        ✨ AI已识别
                      </span>
                    )}
                  </div>
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        起始日 (可选)
                      </label>
                      {aiFilledFields.has('start_date') && (
                        <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                          ✨ AI已识别
                        </span>
                      )}
                    </div>
                    <input
                      type="date"
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        到期日 <span className="text-red-500">*</span>
                      </label>
                      {aiFilledFields.has('end_date') && (
                        <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                          ✨ AI已识别
                        </span>
                      )}
                    </div>
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        合同金额 (¥ 可选)
                      </label>
                      {aiFilledFields.has('amount') && (
                        <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                          ✨ AI已识别
                        </span>
                      )}
                    </div>
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      备注 (可选)
                    </label>
                    {aiFilledFields.has('note') && (
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-1.5 py-0.5 rounded">
                        ✨ AI已识别
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="结款条款、续签对接人联系方式等"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>

                <div className="pt-3 flex items-center justify-end space-x-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={modalLoading || isRecognizing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-xs"
                  >
                    {modalLoading ? '保存中...' : '保存合同'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
