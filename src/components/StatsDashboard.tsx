import React, { useState, useMemo, useEffect } from 'react';
import { InventoryItem, InventorySummary, RequisitionRecord } from '../types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, Cell, Legend, PieChart, Pie 
} from 'recharts';
import { startOfMonth, endOfMonth, isWithinInterval, parseISO, format, differenceInDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { 
  Package, AlertTriangle, XCircle, CheckCircle2, 
  Layers, MapPin, ArrowUpRight, ShieldAlert, Sparkles, RefreshCw, Loader2, 
  ChevronDown, ChevronUp, BarChart3, PieChart as PieChartIcon, TrendingUp, 
  TrendingDown, Boxes, ArrowDownRight, Calendar, ArrowUpDown, Filter,
  ChevronRight, ArrowLeft
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { CategoryView } from './CategoryView';

const CATEGORY_CHART_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#14B8A6', // Teal
  '#6366F1', // Indigo
  '#E11D48', // Rose
];

interface StatsDashboardProps {
  summary: InventorySummary | null;
  items: InventoryItem[];
  requisitions?: RequisitionRecord[];
  onSelectCategory: (category: string) => void;
  onFilterLowStock: () => void;
  onSelectItem: (item: InventoryItem) => void;
  onAskAI: (prompt: string) => void;
  onRefresh: () => void;
  loading: boolean;
  initialSubTab?: 'overview' | 'categories';
  isLowSpec?: boolean;
}

export const StatsDashboard: React.FC<StatsDashboardProps> = ({
  summary,
  items,
  onSelectCategory,
  onFilterLowStock,
  onSelectItem,
  requisitions = [],
  onAskAI,
  onRefresh,
  loading,
  initialSubTab = 'overview',
  isLowSpec = false,
}) => {
  const [viewMode, setViewMode] = useState<'overview' | 'categories'>(initialSubTab || 'overview');

  useEffect(() => {
    if (initialSubTab) {
      setViewMode(initialSubTab);
    }
  }, [initialSubTab]);

  const lowStockItems = useMemo(() => items.filter(i => i.status === 'low' || i.status === 'out'), [items]);

  // --- TIME BOUNDARIES & ANALYTICS ---
  const currentMonthStart = startOfMonth(new Date());
  const currentMonthEnd = endOfMonth(new Date());

  // Category Movement Filter States
  const [categoryTimeRange, setCategoryTimeRange] = useState<'30days' | 'month' | 'all'>('30days');
  const [categoryChartType, setCategoryChartType] = useState<'bar' | 'pie'>('bar');
  const [selectedCategoryDetail, setSelectedCategoryDetail] = useState<string | null>(null);

  // Category-wise Requisition & Movement Analytics
  const categoryDisbursementData = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfCurMonth = startOfMonth(now);
    const endOfCurMonth = endOfMonth(now);

    // Filter requisitions based on selected time range
    const filteredReqs = requisitions.filter(req => {
      if (!req.isoDate) return true;
      try {
        const d = parseISO(req.isoDate);
        if (categoryTimeRange === '30days') {
          return d >= thirtyDaysAgo;
        } else if (categoryTimeRange === 'month') {
          return isWithinInterval(d, { start: startOfCurMonth, end: endOfCurMonth });
        }
        return true;
      } catch (e) {
        return true;
      }
    });

    // Aggregate by category
    const catMap: Record<string, {
      category: string;
      disbursedQty: number;
      stockInQty: number;
      disbursedCount: number;
      stockInCount: number;
      totalStock: number;
    }> = {};

    // Initialize with all categories present in items
    items.forEach(item => {
      const cat = item.category || 'ทั่วไป';
      if (!catMap[cat]) {
        catMap[cat] = {
          category: cat,
          disbursedQty: 0,
          stockInQty: 0,
          disbursedCount: 0,
          stockInCount: 0,
          totalStock: 0,
        };
      }
      catMap[cat].totalStock += (item.qty || 0);
    });

    // Aggregate transaction movements
    filteredReqs.forEach(req => {
      const cat = req.category || 'ทั่วไป';
      if (!catMap[cat]) {
        catMap[cat] = {
          category: cat,
          disbursedQty: 0,
          stockInQty: 0,
          disbursedCount: 0,
          stockInCount: 0,
          totalStock: 0,
        };
      }
      if (req.type === 'out') {
        catMap[cat].disbursedQty += (req.qty || 0);
        catMap[cat].disbursedCount += 1;
      } else if (req.type === 'in') {
        catMap[cat].stockInQty += (req.qty || 0);
        catMap[cat].stockInCount += 1;
      }
    });

    const list = Object.values(catMap);
    const totalDisbursedOverall = list.reduce((acc, curr) => acc + curr.disbursedQty, 0);

    return list.map(item => ({
      ...item,
      netMovement: item.stockInQty - item.disbursedQty,
      percentage: totalDisbursedOverall > 0 ? Math.round((item.disbursedQty / totalDisbursedOverall) * 100) : 0,
    })).sort((a, b) => b.disbursedQty - a.disbursedQty);
  }, [requisitions, items, categoryTimeRange]);

  // Key Category KPI Highlights
  const categoryKpis = useMemo(() => {
    const totalDisbursed = categoryDisbursementData.reduce((acc, c) => acc + c.disbursedQty, 0);
    const totalStockIn = categoryDisbursementData.reduce((acc, c) => acc + c.stockInQty, 0);
    const topCategory = categoryDisbursementData[0] || null;
    const totalTransactions = categoryDisbursementData.reduce((acc, c) => acc + c.disbursedCount + c.stockInCount, 0);

    return {
      totalDisbursed,
      totalStockIn,
      topCategory: topCategory && topCategory.disbursedQty > 0 ? topCategory : null,
      totalTransactions,
      netTotal: totalStockIn - totalDisbursed,
    };
  }, [categoryDisbursementData]);

  const currentMonthRequisitions = useMemo(() => {
    return requisitions.filter(req => {
      if (req.type !== 'out') return false;
      try {
        const d = parseISO(req.isoDate);
        return isWithinInterval(d, { start: currentMonthStart, end: currentMonthEnd });
      } catch (e) {
        return false;
      }
    });
  }, [requisitions, currentMonthStart, currentMonthEnd]);

  const topItemsThisMonth = useMemo(() => {
    const counts: Record<string, { name: string; qty: number }> = {};
    currentMonthRequisitions.forEach(req => {
      if (!counts[req.itemId]) {
        counts[req.itemId] = { name: req.itemName, qty: 0 };
      }
      counts[req.itemId].qty += req.qty;
    });
    return Object.values(counts)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [currentMonthRequisitions]);

  const monthlyTrend = useMemo(() => {
    const trend: Record<string, number> = {};
    const outReqs = requisitions.filter(r => r.type === 'out');
    outReqs.forEach(req => {
      try {
        const d = parseISO(req.isoDate);
        const monthYear = format(d, 'MMM yy', { locale: th });
        trend[monthYear] = (trend[monthYear] || 0) + req.qty;
      } catch (e) {}
    });
    return Object.entries(trend).map(([month, qty]) => ({ month, qty })).reverse().slice(0, 6).reverse(); 
  }, [requisitions]);

  const outOfStockDurations = useMemo(() => {
    const outItems = items.filter(item => item.status === 'out' && item.outOfStockDate);
    return outItems.map(item => {
      try {
        const outDate = parseISO(item.outOfStockDate!);
        const days = differenceInDays(new Date(), outDate);
        return { name: item.name, days: days < 0 ? 0 : days, date: outDate };
      } catch (e) {
        return { name: item.name, days: 0, date: new Date() };
      }
    }).sort((a, b) => b.days - a.days).slice(0, 5);
  }, [items]);

  const [inlineAnalysis, setInlineAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleInlineAnalysis = async () => {
    if (isAnalyzing) return;
    if (inlineAnalysis && showAnalysis) {
      setShowAnalysis(false);
      return;
    }
    if (inlineAnalysis && !showAnalysis) {
      setShowAnalysis(true);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setShowAnalysis(true);
      setInlineAnalysis('📡 ขณะนี้ระบบอยู่ในโหมดออฟไลน์ (Offline Mode) การประมวลผลวิเคราะห์เชิงลึกด้วย AI จำเป็นต้องใช้อินเทอร์เน็ตในการติดต่อโมเดล ข้อมูลสรุปตัวเลขและกราฟด้านล่างสามารถดูได้ตามปกติจากแคชในเครื่องครับ');
      return;
    }

    setIsAnalyzing(true);
    setShowAnalysis(true);
    setInlineAnalysis('');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'วิเคราะห์เชิงลึกสถานะคลังสินค้า Store FL.6 และแนวโน้มการใช้อะไหล่ พร้อมแผนการสั่งซื้อด่วนและข้อเสนอแนะเชิงกลยุทธ์ โดยจัดย่อหน้าเว้นวรรคให้โปร่งตา ใช้สัญลักษณ์และอิโมจิหัวข้อชัดเจน น่าอ่าน',
          items,
          requisitions: currentMonthRequisitions,
        }),
      });

      if (!res.ok) throw new Error('Network error');
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let done = false;
      let textBuffer = '';
      let jsonBuffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          jsonBuffer += chunk;
          const parts = jsonBuffer.split('\n\n');
          jsonBuffer = parts.pop() || '';
          for (const part of parts) {
            if (part.startsWith('data: ')) {
              try {
                const data = JSON.parse(part.slice(6));
                if (data.type === 'chunk') {
                  textBuffer += data.text;
                  setInlineAnalysis(textBuffer);
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (err) {
      setInlineAnalysis('เกิดข้อผิดพลาดในการวิเคราะห์ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-5 md:p-6 pt-3 sm:pt-4 space-y-4.5 pb-28 sm:pb-32 max-w-7xl mx-auto w-full transition-colors duration-200">
      {/* Sub-Navigation Switcher (ภาพรวมสถิติ vs หมวดหมู่สินค้า) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 p-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <button
            type="button"
            onClick={() => setViewMode('overview')}
            className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'overview'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>ภาพรวมสถิติ</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('categories')}
            className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'categories'
                ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/25'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>หมวดหมู่สินค้า</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              viewMode === 'categories'
                ? 'bg-white/20 text-white'
                : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
            }`}>
              {summary?.categories.length || 0}
            </span>
          </button>
        </div>

        {viewMode === 'categories' && (
          <button
            type="button"
            onClick={() => setViewMode('overview')}
            className="px-3.5 py-2 rounded-2xl liquid-glass-pill hover:bg-white/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer shadow-xs border border-white/60 dark:border-white/10"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>กลับไปหน้าภาพรวมสถิติ</span>
          </button>
        )}
      </div>

      {viewMode === 'categories' ? (
        <div className="pt-1">
          <CategoryView
            summary={summary}
            items={items}
            onSelectCategory={onSelectCategory}
            isLowSpec={isLowSpec}
          />
        </div>
      ) : (
        <>
          {/* Top Header Card */}
          <div className="liquid-glass-card rounded-[24px] p-5 sm:p-6 relative overflow-hidden w-full min-w-0">
            {/* Specular top highlight */}
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/80 dark:via-white/25 to-transparent pointer-events-none rounded-full" />

            <div className="flex items-center justify-between mb-3 relative z-10 flex-wrap gap-2">
              <div>
                <span className="text-xs text-blue-600 dark:text-blue-400 font-extrabold tracking-wider uppercase">
                  Store Database
                </span>
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">ภาพรวมคลังสินค้า</h1>
              </div>

              <div className="flex items-center gap-2">
                {/* Button to open Categories in Overview */}
                <button
                  type="button"
                  onClick={() => setViewMode('categories')}
                  className="px-3 sm:px-3.5 py-2 rounded-2xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 active:scale-95 transition-all text-xs sm:text-sm font-bold flex items-center gap-1.5 border border-indigo-200 dark:border-indigo-800/60 shadow-2xs cursor-pointer"
                  title="เปิดดูหมวดหมู่สินค้าทั้งหมด"
                >
                  <Boxes className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>หมวดหมู่ ({summary?.categories.length || 0})</span>
                </button>

                <button
                  onClick={onRefresh}
                  disabled={loading}
                  className="px-3.5 py-2 rounded-2xl liquid-glass-pill hover:bg-white/80 dark:hover:bg-slate-700 active:scale-95 transition-all text-slate-800 dark:text-slate-100 flex items-center gap-1.5 text-xs sm:text-sm font-bold border border-white/60 dark:border-white/10 shadow-2xs cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>ซิงค์ชีต</span>
                </button>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-4.5 leading-relaxed">
              เชื่อมต่อกับ Store Data คลัง Store FL.6 พร้อมอัปเดตและมี AI วิเคราะห์ข้อมูลอัตโนมัติ
            </p>

            {/* 3 Key Metric Blocks */}
            <div className="grid grid-cols-3 gap-2.5 relative z-10">
              <div className="liquid-glass-pill rounded-2xl p-3 sm:p-3.5 border-2 border-slate-200 dark:border-slate-700 text-center shadow-xs">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block font-semibold">สินค้าทั้งหมด</span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  {(summary?.totalItems || items.length).toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">SKUs</span>
              </div>

              <div 
                onClick={onFilterLowStock}
                className="bg-amber-500/15 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-200 rounded-2xl p-3 sm:p-3.5 text-center cursor-pointer active:scale-95 transition-all shadow-xs backdrop-blur-md"
              >
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-tight block truncate">
                  ใกล้หมด/หมดแล้ว
                </span>
                <span className="text-xl sm:text-2xl font-black tabular-nums">
                  {lowStockItems.length.toLocaleString()}
                </span>
                <span className="text-[10px] sm:text-xs opacity-90 block font-bold">กดดูรายการ &gt;</span>
              </div>

              <div className="liquid-glass-pill rounded-2xl p-3 sm:p-3.5 border-2 border-slate-200 dark:border-slate-700 text-center shadow-xs">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block font-semibold">จำนวนรวม</span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  {(summary?.totalQty || 0).toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">หน่วย</span>
              </div>
            </div>
          </div>

          {/* Dedicated Category Mode Banner Card in Overview */}
          <div 
            onClick={() => setViewMode('categories')}
            className="liquid-glass-card rounded-[28px] p-4 sm:p-5 border-2 border-indigo-400/60 dark:border-indigo-500/50 bg-gradient-to-r from-indigo-500/10 via-blue-500/5 to-purple-500/10 flex items-center justify-between cursor-pointer hover:border-indigo-500 active:scale-[0.99] transition-all shadow-md group w-full min-w-0"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/25 border border-indigo-400/30 shrink-0 group-hover:scale-105 transition-transform">
                <Boxes className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                    หมวดหมู่สินค้าในคลัง (Categories)
                  </h3>
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-extrabold px-2.5 py-0.5 rounded-full border border-indigo-400/30">
                    {summary?.categories.length || 0} หมวด
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  แตะเพื่อเปิดดูสินค้าแยกตามหมวดหมู่งานและรูปภาพประกอบ
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs sm:text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0 group-hover:translate-x-1 transition-transform pr-1">
              <span>เปิดดูหมวด</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

      {/* AI Quick Insight Prompt Card */}
      <div className="flex flex-col gap-2">
      <div 
        onClick={handleInlineAnalysis}
        className="liquid-glass-card border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-[28px] p-4 sm:p-5 flex items-center justify-between cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 active:scale-[0.99] transition-all shadow-md"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/25 border border-blue-400/40 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-base sm:text-lg">AI Smart Analysis</h3>
              <span className="text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-300 font-extrabold px-2.5 py-0.5 rounded-full border border-blue-400/30">
                Ai
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">แตะเพื่อให้ Ai วิเคราะห์สถานะคลังสินค้า</p>
          </div>
        </div>
        {isAnalyzing ? <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" /> : (showAnalysis ? <ChevronUp className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />)}
      </div>
      
      {showAnalysis && (
        <div className="liquid-glass-card border-2 border-blue-500/40 dark:border-blue-500/50 bg-white dark:bg-slate-900 rounded-[28px] p-5 sm:p-6 shadow-xl animate-in fade-in slide-in-from-top-2 backdrop-blur-2xl">
          <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-white/40 dark:border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-xs border border-blue-400/40 shadow-xs shrink-0">
                AI
              </div>
              <div>
                <h4 className="font-extrabold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">รายงานวิเคราะห์เชิงลึก (Ai Engine)</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">อัปเดตตามข้อมูลสต็อกและประวัติการเบิกใช้จริง</p>
              </div>
            </div>
            <button
              onClick={() => {
                setInlineAnalysis('');
                setIsAnalyzing(false);
                setTimeout(() => handleInlineAnalysis(), 50);
              }}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-bold text-blue-600 dark:text-blue-400 liquid-glass-pill border border-blue-400/30 hover:bg-blue-500/10 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>วิเคราะห์ใหม่</span>
            </button>
          </div>

          {isAnalyzing && !inlineAnalysis ? (
            <div className="flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400 py-6">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600 dark:text-blue-400" />
              <div className="text-center">
                <p className="font-semibold text-slate-700 dark:text-slate-200 text-xs sm:text-sm">Ai กำลังประมวลผลข้อมูลคลังสินค้า...</p>
                <p className="text-xs text-slate-400 mt-0.5">คำนวณอัตราหมุนเวียน ดัชนีสุขภาพ และจุดสั่งซื้อฉุกเฉิน</p>
              </div>
            </div>
          ) : (
            <div className="prose prose-slate dark:prose-invert max-w-none text-xs sm:text-sm leading-relaxed space-y-2.5 prose-headings:font-bold prose-headings:text-slate-900 dark:prose-headings:text-slate-100 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
              <ReactMarkdown>{inlineAnalysis}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
      </div>

      {/* =========================================================
          NEW: กราฟแสดงสถานะการเบิกจ่ายสินค้าแยกตามหมวดหมู่ (RECHARTS)
          ========================================================= */}
      <div className="liquid-glass-card rounded-[32px] border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xl relative overflow-hidden w-full min-w-0">
        {/* Top Header with Title and Interactive Toggles */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200/60 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-md shadow-blue-500/25 border border-white/30 shrink-0">
              <BarChart3 className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  สถานะการเบิกจ่ายและเคลื่อนไหวแยกตามหมวดหมู่
                </h2>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-400/30">
                  Recharts Analytics
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                เปรียบเทียบยอดเบิกใช้ (ออก) และรับเข้าสต็อก (เข้า) ของแต่ละหมวดหมู่งาน
              </p>
            </div>
          </div>

          {/* Interactive Filters (Time Range & Chart Type) */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time Range Filter */}
            <div className="flex items-center p-1 rounded-2xl liquid-glass-pill border border-white/60 dark:border-white/10 text-xs shadow-2xs">
              <button
                type="button"
                onClick={() => setCategoryTimeRange('30days')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  categoryTimeRange === '30days'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                30 วันล่าสุด
              </button>
              <button
                type="button"
                onClick={() => setCategoryTimeRange('month')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  categoryTimeRange === 'month'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                เดือนนี้
              </button>
              <button
                type="button"
                onClick={() => setCategoryTimeRange('all')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  categoryTimeRange === 'all'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                ทั้งหมด
              </button>
            </div>

            {/* Chart Type Toggle */}
            <div className="flex items-center p-1 rounded-2xl liquid-glass-pill border border-white/60 dark:border-white/10 text-xs shadow-2xs">
              <button
                type="button"
                onClick={() => setCategoryChartType('bar')}
                title="ดูกราฟแท่งเปรียบเทียบ"
                className={`p-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 font-bold ${
                  categoryChartType === 'bar'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">กราฟแท่ง</span>
              </button>
              <button
                type="button"
                onClick={() => setCategoryChartType('pie')}
                title="ดูกราฟสัดส่วน"
                className={`p-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 font-bold ${
                  categoryChartType === 'pie'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <PieChartIcon className="w-4 h-4" />
                <span className="hidden sm:inline">สัดส่วน %</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick KPI Strip for Category Movement */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
          <div className="liquid-glass-pill rounded-2xl p-3 border border-blue-400/20 bg-blue-500/5 dark:bg-blue-950/20 shadow-2xs">
            <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 text-xs font-bold mb-1">
              <TrendingDown className="w-3.5 h-3.5" />
              <span>เบิกจ่ายรวม</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
              {categoryKpis.totalDisbursed} <span className="text-xs font-semibold text-slate-400">ชิ้น</span>
            </div>
          </div>

          <div className="liquid-glass-pill rounded-2xl p-3 border border-emerald-400/20 bg-emerald-500/5 dark:bg-emerald-950/20 shadow-2xs">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>รับเข้ารวม</span>
            </div>
            <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
              {categoryKpis.totalStockIn} <span className="text-xs font-semibold text-slate-400">ชิ้น</span>
            </div>
          </div>

          <div className="liquid-glass-pill rounded-2xl p-3 border border-indigo-400/20 bg-indigo-500/5 dark:bg-indigo-950/20 shadow-2xs">
            <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs font-bold mb-1 truncate">
              <Boxes className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">หมวดที่เบิกสูงสุด</span>
            </div>
            <div className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate" title={categoryKpis.topCategory?.category || '-'}>
              {categoryKpis.topCategory ? categoryKpis.topCategory.category : '-'}
            </div>
            {categoryKpis.topCategory && (
              <span className="text-[10.5px] text-indigo-500 font-bold block">
                {categoryKpis.topCategory.disbursedQty} ชิ้น ({categoryKpis.topCategory.percentage}%)
              </span>
            )}
          </div>

          <div className="liquid-glass-pill rounded-2xl p-3 border border-violet-400/20 bg-violet-500/5 dark:bg-violet-950/20 shadow-2xs">
            <div className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 text-xs font-bold mb-1">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>การเคลื่อนไหวสุทธิ</span>
            </div>
            <div className={`text-lg sm:text-xl font-black ${
              categoryKpis.netTotal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {categoryKpis.netTotal >= 0 ? `+${categoryKpis.netTotal}` : categoryKpis.netTotal}{' '}
              <span className="text-xs font-semibold text-slate-400">ชิ้น</span>
            </div>
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="w-full">
          {categoryDisbursementData.length === 0 || (categoryKpis.totalDisbursed === 0 && categoryKpis.totalStockIn === 0) ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <Boxes className="w-8 h-8 opacity-40" />
              <p className="text-xs sm:text-sm font-semibold">ยังไม่มีประวัติการเบิกจ่ายหรือรับเข้าในหมวดหมู่ช่วงเวลานี้</p>
            </div>
          ) : categoryChartType === 'bar' ? (
            <div className="h-72 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryDisbursementData.slice(0, 10)}
                  margin={{ top: 10, right: 15, left: -10, bottom: 25 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#64748b" opacity={0.15} />
                  <XAxis 
                    dataKey="category" 
                    tick={{ fontSize: 11 }} 
                    stroke="#94a3b8" 
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(100, 116, 139, 0.08)' }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="liquid-glass-card rounded-2xl p-3.5 border border-white/40 dark:border-white/10 shadow-2xl backdrop-blur-2xl text-xs space-y-1.5 min-w-[190px]">
                            <p className="font-extrabold text-sm text-slate-900 dark:text-white border-b border-white/20 pb-1 flex items-center justify-between">
                              <span>{label}</span>
                              <span className="text-[10px] text-blue-500 font-bold">{data.percentage}% ของยอดเบิก</span>
                            </p>
                            <div className="space-y-1 pt-0.5">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold">
                                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                                  เบิกจ่าย (ออก):
                                </span>
                                <span className="font-black text-slate-900 dark:text-white">
                                  {data.disbursedQty} ชิ้น ({data.disbursedCount} ครั้ง)
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                                  รับเข้า (เข้า):
                                </span>
                                <span className="font-black text-slate-900 dark:text-white">
                                  {data.stockInQty} ชิ้น ({data.stockInCount} ครั้ง)
                                </span>
                              </div>
                              <div className="flex items-center justify-between border-t border-slate-200/40 dark:border-white/10 pt-1 text-[11px]">
                                <span className="text-slate-500 dark:text-slate-400">สต็อกคงเหลือปัจจุบัน:</span>
                                <span className="font-extrabold text-slate-700 dark:text-slate-200">{data.totalStock} ชิ้น</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    align="right" 
                    wrapperStyle={{ fontSize: '11.5px', paddingBottom: '12px' }} 
                  />
                  <Bar 
                    dataKey="disbursedQty" 
                    name="ยอดเบิกจ่าย (ออก)" 
                    fill="#3B82F6" 
                    radius={[6, 6, 0, 0]} 
                    isAnimationActive={!isLowSpec}
                    cursor="pointer"
                    onClick={(entry: any) => {
                      const cat = entry?.category || entry?.payload?.category;
                      if (cat) onSelectCategory(cat);
                    }}
                  />
                  <Bar 
                    dataKey="stockInQty" 
                    name="ยอดรับเข้า (เข้า)" 
                    fill="#10B981" 
                    radius={[6, 6, 0, 0]} 
                    isAnimationActive={!isLowSpec}
                    cursor="pointer"
                    onClick={(entry: any) => {
                      const cat = entry?.category || entry?.payload?.category;
                      if (cat) onSelectCategory(cat);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              {/* Donut / Pie Chart */}
              <div className="h-72 md:col-span-6 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryDisbursementData.filter(d => d.disbursedQty > 0)}
                      dataKey="disbursedQty"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={3}
                      isAnimationActive={!isLowSpec}
                      cursor="pointer"
                      onClick={(entry: any) => {
                        const cat = entry?.category || entry?.name || entry?.payload?.category;
                        if (cat) onSelectCategory(cat);
                      }}
                    >
                      {categoryDisbursementData.filter(d => d.disbursedQty > 0).map((entry, index) => (
                        <Cell 
                          key={`cell-${entry.category}`} 
                          fill={CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]} 
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="liquid-glass-card rounded-2xl p-3 border border-white/40 dark:border-white/10 shadow-2xl backdrop-blur-2xl text-xs">
                              <p className="font-extrabold text-slate-900 dark:text-white mb-1">{data.category}</p>
                              <p className="text-blue-600 dark:text-blue-400 font-bold">
                                ยอดเบิก: {data.disbursedQty} ชิ้น ({data.percentage}%)
                              </p>
                              <p className="text-slate-500 text-[11px]">จำนวนครั้งที่เบิก: {data.disbursedCount} ครั้ง</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Pie Chart Legend & Breakdown List */}
              <div className="md:col-span-6 space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-none">
                {categoryDisbursementData.filter(d => d.disbursedQty > 0).slice(0, 7).map((cat, idx) => (
                  <div
                    key={cat.category}
                    onClick={() => onSelectCategory(cat.category)}
                    className="flex items-center justify-between p-2 rounded-xl liquid-glass-pill hover:bg-blue-500/10 transition-all cursor-pointer border border-white/40 dark:border-white/5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span 
                        className="w-3 h-3 rounded-full shrink-0 shadow-2xs" 
                        style={{ backgroundColor: CATEGORY_CHART_COLORS[idx % CATEGORY_CHART_COLORS.length] }} 
                      />
                      <span className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">{cat.category}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-extrabold text-xs text-slate-900 dark:text-white block">
                        {cat.disbursedQty} ชิ้น
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Detailed Category Movement Expandable Badges Strip */}
        <div className="mt-4 pt-3.5 border-t border-slate-200/60 dark:border-white/10 flex items-center justify-between flex-wrap gap-2 text-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            💡 คลิกที่แท่งกราฟหรือชื่อหมวดหมู่เพื่อกรองรายการสินค้าในหมวดนั้นทันที
          </span>
          <div className="flex items-center gap-2 text-[11px] font-bold">
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> เบิกออก
            </span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> รับเข้า
            </span>
          </div>
        </div>
      </div>

      {/* Responsive Analytics & Breakdown Grid (1 col on phone, 2 cols on tablet/desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4.5 w-full min-w-0">
        {/* Low Stock Alert Section */}
        {lowStockItems.length > 0 && (
          <div className="liquid-glass-card rounded-[28px] border-2 border-amber-300 dark:border-amber-600/60 bg-white dark:bg-slate-900 p-5 shadow-lg w-full min-w-0">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm sm:text-base">รายการสต็อกที่ต้องเติม ({lowStockItems.length})</h2>
              </div>
              <button
                onClick={onFilterLowStock}
                className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
              >
                ดูทั้งหมด
              </button>
            </div>

            <div className="space-y-2.5">
              {lowStockItems.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectItem(item)}
                  className="bg-amber-500/10 dark:bg-amber-950/30 hover:bg-amber-500/20 dark:hover:bg-amber-950/50 border border-amber-400/30 dark:border-amber-700/40 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all active:scale-98 shadow-2xs backdrop-blur-md"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm truncate">{item.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {item.id} • {item.category} • ที่เก็บ: {item.location}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs sm:text-sm font-extrabold text-amber-600 dark:text-amber-400 block">
                      เหลือ {item.qty} {item.unit}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">Min: {item.minStock}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category Breakdown Section */}
        <div className="liquid-glass-card rounded-[28px] border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-lg w-full min-w-0">
          <div className="flex items-center gap-2 mb-3.5">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm sm:text-base">สัดส่วนสินค้าตามหมวดหมู่</h2>
          </div>

          <div className="space-y-2.5">
            {summary?.categories.map((cat) => {
              const percentage = Math.round((cat.count / (summary.totalItems || 1)) * 100);
              return (
                <div
                  key={cat.name}
                  onClick={() => onSelectCategory(cat.name)}
                  className="p-2.5 rounded-2xl hover:bg-blue-500/10 dark:hover:bg-slate-800/80 border border-transparent hover:border-white/40 dark:hover:border-white/10 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5">
                    <span className="font-bold text-slate-700 dark:text-slate-200">{cat.name}</span>
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">
                      {cat.count} รายการ ({cat.totalQty} ชิ้น)
                    </span>
                  </div>
                  <div className="w-full bg-slate-200/50 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden border border-white/40 dark:border-white/10">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(percentage, 5)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Analytics: Top Items This Month */}
        {topItemsThisMonth.length > 0 && (
          <div className="liquid-glass-card rounded-[28px] border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-lg w-full min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
              <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm sm:text-base">รายการเบิกสูงสุดเดือนนี้</h2>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItemsThisMonth} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.2} />
                  <XAxis type="number" stroke="#94a3b8" />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)', backgroundColor: 'rgba(15,23,42,0.94)', color: '#f8fafc' }} />
                  <Bar dataKey="qty" name="จำนวนที่เบิก" fill="#10B981" radius={[0, 6, 6, 0]} isAnimationActive={!isLowSpec} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Analytics: Monthly Trend */}
        {monthlyTrend.length > 0 && (
          <div className="liquid-glass-card rounded-[28px] border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-lg w-full min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <ArrowUpRight className="w-5 h-5 text-blue-500 dark:text-blue-400" />
              <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm sm:text-base">แนวโน้มการเบิกจ่าย (ยอดรวม)</h2>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <RechartsTooltip cursor={{fill: 'rgba(100,116,139,0.08)'}} contentStyle={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)', backgroundColor: 'rgba(15,23,42,0.94)', color: '#f8fafc' }} />
                  <Bar dataKey="qty" name="จำนวนรวม" fill="#3B82F6" radius={[6, 6, 0, 0]} isAnimationActive={!isLowSpec} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Analytics: Out of Stock Duration */}
        {outOfStockDurations.length > 0 && (
          <div className="liquid-glass-card rounded-[28px] border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-lg lg:col-span-2 w-full min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
              <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm sm:text-base">สินค้าหมดสต๊อกนานที่สุด (วัน)</h2>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={outOfStockDurations} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={60} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <RechartsTooltip cursor={{fill: 'rgba(100,116,139,0.08)'}} contentStyle={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)', backgroundColor: 'rgba(15,23,42,0.94)', color: '#f8fafc' }} />
                  <Bar dataKey="days" name="จำนวนวัน" fill="#EF4444" radius={[6, 6, 0, 0]} isAnimationActive={!isLowSpec}>
                    {outOfStockDurations.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.days > 7 ? '#EF4444' : '#F87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};

