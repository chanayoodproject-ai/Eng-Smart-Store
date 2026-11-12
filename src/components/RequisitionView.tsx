import React, { useState, useMemo, useDeferredValue } from 'react';
import { RequisitionRecord, InventoryItem } from '../types';
import { 
  ClipboardList, Search, Clock, MapPin,
  Plus, Package, FileText, Trash2, FileDown, Loader2,
  ArrowDownRight, ArrowUpRight, CheckCircle2, AlertTriangle, XCircle, Boxes, Edit3, CheckSquare,
  Camera, Sparkles
} from 'lucide-react';
import { formatRecordTimestamp } from '../utils/dateUtils';

interface RequisitionViewProps {
  records: RequisitionRecord[];
  items: InventoryItem[];
  isAdmin?: boolean;
  onOpenNewRequisition: () => void;
  onStartMultiSelect?: () => void;
  onOpenInvoiceScan?: () => void;
  onDeleteRecord: (id: string) => void;
  onEditRecord?: (record: RequisitionRecord) => void;
}

export const RequisitionView: React.FC<RequisitionViewProps> = ({
  records,
  items,
  isAdmin = false,
  onOpenNewRequisition,
  onStartMultiSelect,
  onOpenInvoiceScan,
  onDeleteRecord,
  onEditRecord,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [typeFilter, setTypeFilter] = useState<'all' | 'out' | 'in'>('all');

  const getCategoryColor = (_cat?: string) => {
    return 'bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200/90 dark:border-slate-700/80';
  };

  // O(1) lookup maps for inventory items by ID and Name to eliminate O(N*M) array scans per card
  const itemLookup = useMemo(() => {
    const byId = new Map<string, InventoryItem>();
    const byName = new Map<string, InventoryItem>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.id) byId.set(it.id, it);
      if (it.name) byName.set(it.name, it);
    }
    return { byId, byName };
  }, [items]);

  // Single-pass memoized statistics
  const { totalWithdrawn, totalReceived, outRecordsCount, inRecordsCount } = useMemo(() => {
    let withdrawn = 0;
    let received = 0;
    let outCount = 0;
    let inCount = 0;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === 'in') {
        received += r.qty;
        inCount++;
      } else {
        withdrawn += r.qty;
        outCount++;
      }
    }
    return {
      totalWithdrawn: withdrawn,
      totalReceived: received,
      outRecordsCount: outCount,
      inRecordsCount: inCount,
    };
  }, [records]);

  // Filtered records by deferred search and type
  const filteredRecords = useMemo(() => {
    const q = deferredSearchTerm.trim().toLowerCase();
    return records.filter((rec) => {
      const matchesType =
        typeFilter === 'all'
          ? true
          : typeFilter === 'in'
          ? rec.type === 'in'
          : rec.type === 'out' || !rec.type;

      if (!matchesType) return false;
      if (!q) return true;

      return (
        rec.requestedBy.toLowerCase().includes(q) ||
        rec.itemName.toLowerCase().includes(q) ||
        rec.itemId.toLowerCase().includes(q) ||
        rec.purpose.toLowerCase().includes(q) ||
        rec.category.toLowerCase().includes(q)
      );
    });
  }, [records, deferredSearchTerm, typeFilter]);

  return (
    <div className="flex flex-col min-h-full transition-colors duration-200">
      {/* Subheader */}
      <div className="eng-header px-4 sm:px-6 py-4 shrink-0">
        <div className="max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-blue-500/25">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">ประวัติการเบิก / รับเข้า</h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">บันทึกความเคลื่อนไหวสต็อกสินค้าเข้า-ออก</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenInvoiceScan && (
              <button
                onClick={onOpenInvoiceScan}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white px-3.5 py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-md shadow-emerald-500/25 transition-all border border-emerald-400/30 cursor-pointer"
                title="ถ่ายรูปหรืออัปโหลดใบส่งของ (DO) / Invoice เพื่อรับของเข้าคลังอัตโนมัติด้วย AI"
              >
                <Camera className="w-4 h-4" />
                <span>สแกนใบส่งของ</span>
              </button>
            )}

            {onStartMultiSelect && (
              <button
                onClick={onStartMultiSelect}
                className="liquid-glass-pill hover:bg-white text-slate-700 dark:text-slate-200 px-3.5 py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all border border-white/60 dark:border-white/10 cursor-pointer shadow-2xs active:scale-95"
                title="เปิดโหมดเลือกสินค้าหลายชิ้นเพื่อเบิกพร้อมกัน"
              >
                <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>เลือกหลายชิ้น</span>
              </button>
            )}

            <button
              onClick={onOpenNewRequisition}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-95 text-white px-3.5 py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/25 transition-all border border-blue-400/30 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              บันทึก เบิก/รับเข้า
            </button>
          </div>
        </div>

        {/* Stats summary banner */}
        <div className="grid grid-cols-3 gap-2.5 mt-3.5 pt-3.5 border-t-2 border-slate-200 dark:border-slate-800">
          <div className="liquid-glass-pill p-2.5 rounded-2xl border-2 border-slate-200 dark:border-slate-700/80 text-center shadow-xs">
            <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 block font-semibold">รายการทั้งหมด</span>
            <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white tabular-nums">
              {records.length.toLocaleString()} ครั้ง
            </span>
          </div>
          <div className="bg-red-500/10 dark:bg-red-950/40 border-2 border-red-500/40 dark:border-red-600/50 text-red-700 dark:text-red-300 p-2.5 rounded-2xl text-center shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold block">เบิกออกรวม</span>
            <span className="text-base sm:text-lg font-black tabular-nums">
              {totalWithdrawn.toLocaleString()} ชิ้น
            </span>
          </div>
          <div className="bg-emerald-500/10 dark:bg-emerald-950/40 border-2 border-emerald-500/40 dark:border-emerald-600/50 text-emerald-700 dark:text-emerald-300 p-2.5 rounded-2xl text-center shadow-xs">
            <span className="text-[11px] sm:text-xs font-bold block">รับเข้ารวม</span>
            <span className="text-base sm:text-lg font-black tabular-nums">
              +{totalReceived.toLocaleString()} ชิ้น
            </span>
          </div>
        </div>

        {/* Type Filter Buttons */}
        <div className="flex items-center gap-2 mt-3.5 pt-1">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-2xs active:scale-95 border ${
              typeFilter === 'all'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-800 dark:border-white/40 shadow-sm'
                : 'liquid-glass-pill text-slate-600 dark:text-slate-300 border-white/60 dark:border-white/10 hover:bg-white dark:hover:bg-slate-800'
            }`}
          >
            ทั้งหมด ({records.length})
          </button>
          <button
            onClick={() => setTypeFilter('out')}
            className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs active:scale-95 border ${
              typeFilter === 'out'
                ? 'bg-red-600 text-white border-red-500 shadow-sm'
                : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40 hover:opacity-90'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
            เบิกออก ({outRecordsCount})
          </button>
          <button
            onClick={() => setTypeFilter('in')}
            className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs active:scale-95 border ${
              typeFilter === 'in'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-red-800/40 hover:opacity-90'
            }`}
          >
            <ArrowDownRight className="w-3.5 h-3.5 stroke-[2.5]" />
            รับเข้า ({inRecordsCount})
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mt-3">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาชื่อผู้ทำรายการ, สินค้า, รหัส หรือสถานที่..."
            className="w-full liquid-glass-input rounded-2xl pl-10 pr-4 py-2.5 text-sm sm:text-base text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner transition-all"
          />
        </div>
        </div>
      </div>

      {/* Record list container */}
      <div className="flex-1 p-3.5 sm:p-5 md:p-6 pb-28 sm:pb-32">
        {filteredRecords.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-12 px-5 border border-dashed border-white/60 dark:border-white/10 rounded-[28px] liquid-glass-card shadow-lg">
            <div className="w-14 h-14 liquid-glass-pill rounded-2xl flex items-center justify-center mx-auto mb-3 text-slate-400 dark:text-slate-400 border border-white/60 dark:border-white/10 shadow-xs">
              <ClipboardList className="w-6 h-6" />
            </div>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-lg mb-1">
              {searchTerm
                ? 'ไม่พบประวัติที่ตรงกับคำค้นหา'
                : 'ยังไม่มีประวัติการเบิกหรือรับเข้าสินค้า'}
            </h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">
              แตะปุ่ม "บันทึก เบิก/รับเข้า" ด้านบนเพื่อเริ่มบันทึกรายการ
            </p>
            <button
              onClick={onOpenNewRequisition}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold px-4 py-2.5 rounded-2xl shadow-md inline-flex items-center gap-1.5 cursor-pointer border border-blue-400/40"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              บันทึก เบิก/รับเข้า
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4.5 max-w-7xl mx-auto w-full min-w-0">
            {filteredRecords.map((record) => {
            const isStockIn = record.type === 'in';
            
            // O(1) Map lookup for current inventory item matching this record
            const currentItem = itemLookup.byId.get(record.itemId) || 
                                 itemLookup.byName.get(record.itemName);
            
            const currentQty = currentItem ? currentItem.qty : null;
            const currentUnit = currentItem ? currentItem.unit : record.unit;
            const currentStatus = currentItem ? currentItem.status : 'normal';

            return (
              <div
                key={record.id}
                className="item-card-container liquid-glass-card rounded-[26px] border-2 border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-md hover:border-blue-500/60 dark:hover:border-blue-400/60 transition-colors space-y-3 relative overflow-hidden w-full min-w-0 box-border"
              >

                {/* Top: User Info, Type Badge & Timestamp */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                      isStockIn 
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/30' 
                        : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-400/30'
                    }`}>
                      {isStockIn ? (
                        <ArrowDownRight className="w-4.5 h-4.5 stroke-[2.5]" />
                      ) : (
                        <ArrowUpRight className="w-4.5 h-4.5 stroke-[2.5]" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                          {record.requestedBy}
                        </h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                          isStockIn
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30'
                            : 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30'
                        }`}>
                          {isStockIn ? 'รับเข้า' : 'เบิกออก'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-400 mt-0.5 font-medium">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatRecordTimestamp(record.timestamp, record.isoDate)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Transaction Quantity Badge */}
                  <div className="text-right">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-2xl text-sm sm:text-base font-black border shadow-2xs ${
                      isStockIn
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/40'
                        : 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/40'
                    }`}>
                      {isStockIn ? `+${record.qty}` : `-${record.qty}`} {record.unit}
                    </span>
                  </div>
                </div>

                {/* Middle: Item Details */}
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3.5 border-2 border-slate-200/90 dark:border-slate-700/80">
                  <div className="flex items-start gap-3">
                    {/* Item Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span className="font-mono text-xs font-black text-slate-800 dark:text-white bg-white dark:bg-slate-900 px-2.5 py-0.5 rounded-full border border-slate-300 dark:border-slate-700 shadow-2xs">
                          {record.itemId}
                        </span>
                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full border liquid-glass-pill ${getCategoryColor(
                            record.category
                          )}`}
                        >
                          {record.category}
                        </span>
                      </div>

                      <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm sm:text-base leading-snug line-clamp-2">
                        {record.itemName}
                      </h4>

                      {/* CURRENT WAREHOUSE STOCK BALANCE */}
                      <div className="mt-2.5 pt-2 border-t border-white/40 dark:border-white/10 flex items-center justify-between flex-wrap gap-1">
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm">
                          <Boxes className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span className="text-slate-500 dark:text-slate-400 font-medium">สต็อกคงเหลือปัจจุบัน:</span>
                          <span className="font-black text-slate-900 dark:text-white">
                            {currentQty !== null ? `${currentQty} ${currentUnit}` : 'ไม่พบข้อมูล'}
                          </span>
                        </div>

                        {currentQty !== null && (
                          <div>
                            {currentStatus === 'out' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-300 bg-red-500/15 border border-red-400/30 px-2 py-0.5 rounded-full">
                                <XCircle className="w-3 h-3" /> หมดสต็อก
                              </span>
                            ) : currentStatus === 'low' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-400/30 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" /> สต็อกเหลือน้อย
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-3 h-3" /> ปกติ
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom: Purpose / Location & Note */}
                <div className="space-y-1.5 text-xs sm:text-sm">
                  <div className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300">
                    <MapPin className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isStockIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`} />
                    <span className="font-medium">
                      <strong className="text-slate-900 dark:text-slate-100 font-bold">
                        {isStockIn ? 'แหล่งที่มา / เหตุผล:' : 'งานที่นำไปใช้:'}
                      </strong>{' '}
                      {record.purpose}
                    </span>
                  </div>

                  {record.note && (
                    <div className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>หมายเหตุ: {record.note}</span>
                    </div>
                  )}
                </div>

                {/* Admin Actions: Edit & Delete (Only visible for Admin) */}
                {isAdmin && (
                  <div className="pt-2.5 border-t border-white/40 dark:border-white/10 flex items-center justify-end gap-2">
                    {onEditRecord && (
                      <button
                        onClick={() => onEditRecord(record)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 liquid-glass-pill hover:bg-blue-500/10 flex items-center gap-1 font-bold transition-all px-3 py-1.5 rounded-xl cursor-pointer border border-blue-400/30 shadow-2xs"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        แก้ไขประวัติ
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const cleanId = record.id.replace(/^REQ-?/i, '');
                        if (confirm(`คุณต้องการลบประวัติรายการ "${record.itemName}" (${cleanId}) ใช่หรือไม่?`)) {
                          onDeleteRecord(record.id);
                        }
                      }}
                      className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 liquid-glass-pill hover:bg-red-500/10 flex items-center gap-1 font-bold transition-all px-3 py-1.5 rounded-xl cursor-pointer border border-red-400/30 shadow-2xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      ลบประวัตินี้
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
};
