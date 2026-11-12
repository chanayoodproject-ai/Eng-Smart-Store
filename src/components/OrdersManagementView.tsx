import React, { useState } from 'react';
import { 
  ShoppingCart, 
  Search, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Package, 
  AlertCircle, 
  User as UserIcon, 
  Building, 
  MapPin, 
  Check, 
  Send, 
  Boxes, 
  Loader2,
  Flame,
  Zap,
  Award,
  Layers,
  Truck,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  History,
  Sparkles,
  Inbox,
  Plus,
  FileDown
} from 'lucide-react';
import { PurchaseOrder, User, InventoryItem } from '../types';
import { ModalPortal } from './ModalPortal';

interface OrdersManagementViewProps {
  orders: PurchaseOrder[];
  items: InventoryItem[];
  currentUser: User | null;
  onConfirmOrder: (orderId: string) => Promise<void>;
  onReceiveOrder: (orderId: string, receivedQty: number, note?: string) => Promise<void>;
  onCancelOrder: (orderId: string, reason?: string) => Promise<void>;
  onResendLineNotification: (order: PurchaseOrder) => Promise<void>;
  onOpenAddItemForOrder?: (order: PurchaseOrder) => void;
  onOpenLineSettings?: () => void;
  onOpenCreateOrder?: (item?: InventoryItem | null) => void;
  onOpenReportModal?: (type?: any, user?: string) => void;
}

export const OrdersManagementView: React.FC<OrdersManagementViewProps> = ({
  orders,
  items,
  currentUser,
  onConfirmOrder,
  onReceiveOrder,
  onCancelOrder,
  onResendLineNotification,
  onOpenLineSettings,
  onOpenCreateOrder,
  onOpenReportModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all_sections' | 'pending' | 'confirmed' | 'received' | 'cancelled'>('all_sections');
  const [showHistory, setShowHistory] = useState(false);
  
  // State for Receive Goods Modal
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [receivedQty, setReceivedQty] = useState<number | string>(1);
  const [receiveNote, setReceiveNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  // Filtering function
  const filterBySearch = (orderList: PurchaseOrder[]) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return orderList;

    return orderList.filter((order) => {
      return (
        order.id.toLowerCase().includes(term) ||
        order.itemId.toLowerCase().includes(term) ||
        order.itemName.toLowerCase().includes(term) ||
        order.requestedBy.toLowerCase().includes(term) ||
        (order.category && order.category.toLowerCase().includes(term)) ||
        (order.supplier && order.supplier.toLowerCase().includes(term)) ||
        (order.note && order.note.toLowerCase().includes(term))
      );
    });
  };

  // Group orders by status
  const pendingOrders = filterBySearch(orders.filter((o) => o.status === 'pending'));
  const confirmedOrders = filterBySearch(orders.filter((o) => o.status === 'confirmed'));
  const receivedOrders = filterBySearch(orders.filter((o) => o.status === 'received'));
  const cancelledOrders = filterBySearch(orders.filter((o) => o.status === 'cancelled'));

  // Summary counts (unfiltered for badges)
  const pendingCount = orders.filter((o) => o.status === 'pending').length;
  const confirmedCount = orders.filter((o) => o.status === 'confirmed').length;
  const receivedCount = orders.filter((o) => o.status === 'received').length;
  const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;

  const handleOpenReceive = (order: PurchaseOrder) => {
    setReceivingOrder(order);
    setReceivedQty(order.qty);
    setReceiveNote(`รับของตามใบสั่งซื้อ ${order.id}`);
  };

  const handleConfirmReceive = async () => {
    if (!receivingOrder) return;
    try {
      setIsProcessing(true);
      const targetName = receivingOrder.itemName;
      await onReceiveOrder(receivingOrder.id, Number(receivedQty) || receivingOrder.qty, receiveNote);
      setReceivingOrder(null);
      setActionSuccessMsg(`รับสินค้า "${targetName}" เข้าคลังเรียบร้อยแล้ว`);
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } catch (_err) {
      // Keep modal open if an unexpected error occurs
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickConfirm = async (orderId: string) => {
    try {
      setIsProcessing(true);
      await onConfirmOrder(orderId);
      setActionSuccessMsg(`ยืนยันคำสั่งซื้อ ${orderId} สำเร็จ`);
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickCancel = async (order: PurchaseOrder) => {
    if (!window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการยกเลิกคำสั่งซื้อ "${order.id}" (${order.itemName})?`)) return;
    try {
      setIsProcessing(true);
      await onCancelOrder(order.id, 'ผู้ดูแลระบบยกเลิกผ่านหน้าเว็บ');
      setActionSuccessMsg(`ยกเลิกคำสั่งซื้อ ${order.id} แล้ว`);
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResend = async (order: PurchaseOrder) => {
    try {
      setIsProcessing(true);
      await onResendLineNotification(order);
      setActionSuccessMsg(`ส่งการแจ้งเตือนคำสั่งซื้อ ${order.id} ไปยัง LINE แล้ว`);
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  // Render individual Order Card
  const renderOrderCard = (order: PurchaseOrder) => {
    const isPending = order.status === 'pending';
    const isConfirmed = order.status === 'confirmed';
    const isReceived = order.status === 'received';
    const isCancelled = order.status === 'cancelled';

    return (
      <div
        key={order.id}
        className={`group rounded-3xl p-4 sm:p-5 border-2 transition-all duration-200 shadow-md relative overflow-hidden w-full min-w-0 box-border ${
          isPending
            ? 'bg-white dark:bg-slate-900 border-amber-400 dark:border-amber-500 shadow-amber-500/10 hover:border-amber-500'
            : isConfirmed
            ? 'bg-white dark:bg-slate-900 border-emerald-400 dark:border-emerald-500 shadow-emerald-500/10 hover:border-emerald-500'
            : isReceived
            ? 'bg-white dark:bg-slate-900 border-blue-400 dark:border-blue-500 shadow-blue-500/10 hover:border-blue-500'
            : 'bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-700 opacity-80'
        }`}
      >
        {/* Top Status Accent Bar */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            isPending 
              ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500' 
              : isConfirmed 
              ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500' 
              : isReceived 
              ? 'bg-gradient-to-r from-blue-400 to-indigo-500' 
              : 'bg-slate-300 dark:bg-slate-700'
          }`} 
        />

        {/* Header row: Order ID, Badges, Time */}
        <div className="flex items-center justify-between gap-2 flex-wrap pb-3 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs sm:text-sm font-black px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700/80 shadow-2xs">
              {order.id}
            </span>

            {/* Urgency Badge */}
            {order.urgency === 'critical' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                <Flame className="w-3 h-3 text-rose-500 animate-bounce" />
                <span>ด่วนที่สุด</span>
              </span>
            ) : order.urgency === 'urgent' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                <Zap className="w-3 h-3 text-amber-500" />
                <span>ด่วน</span>
              </span>
            ) : null}

            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {order.createdAt || (order.isoDate ? new Date(order.isoDate).toLocaleString('th-TH') : '')}
            </span>
          </div>

          {/* Status Indicator Pill */}
          <div>
            {isPending && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700/60 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>รอยืนยันสั่งซื้อ</span>
              </span>
            )}
            {isConfirmed && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700/60 shadow-2xs">
                <Truck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>ยืนยันแล้ว / รอรับของ</span>
              </span>
            )}
            {isReceived && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/15 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 shadow-2xs">
                <Boxes className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>รับเข้าคลังแล้ว</span>
              </span>
            )}
            {isCancelled && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                <XCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>ยกเลิกแล้ว</span>
              </span>
            )}
          </div>
        </div>

        {/* Main Content Grid: Item Info & Quantity */}
        <div className="pt-3.5 grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center">
          {/* Left Column: Product description & details */}
          <div className="md:col-span-8 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-lg border border-blue-200 dark:border-blue-800/60">
                {order.itemId}
              </span>
              {order.category && (
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                  หมวด: {order.category}
                </span>
              )}
              {order.location && (
                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  <span>{order.location}</span>
                </span>
              )}
            </div>

            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
              {order.itemName}
            </h3>

            {/* Requester, Brand, Model & Notes */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-0.5">
              <div className="flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                <span>ผู้ขอสั่ง: <strong className="text-slate-900 dark:text-slate-100">{order.requestedBy}</strong></span>
              </div>

              {order.brand && (
                <div className="flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-amber-500" />
                  <span>ยี่ห้อ: <strong className="text-slate-900 dark:text-slate-100">{order.brand}</strong></span>
                </div>
              )}

              {order.model && (
                <div className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-blue-500" />
                  <span>รุ่น: <strong className="text-slate-900 dark:text-slate-100">{order.model}</strong></span>
                </div>
              )}

              {order.supplier && (
                <div className="flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>ร้านค้า/ผู้ขาย: <strong className="text-slate-900 dark:text-slate-100">{order.supplier}</strong></span>
                </div>
              )}

              {order.confirmedBy && (
                <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>อนุมัติโดย: <strong>{order.confirmedBy}</strong></span>
                  {order.confirmedAt && <span className="opacity-75">({order.confirmedAt})</span>}
                </div>
              )}

              {order.receivedBy && (
                <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300 font-medium">
                  <Boxes className="w-3.5 h-3.5 text-blue-600" />
                  <span>รับของโดย: <strong>{order.receivedBy}</strong></span>
                  {order.receivedAt && <span className="opacity-75">({order.receivedAt})</span>}
                </div>
              )}
            </div>

            {order.note && (
              <p className="text-xs text-slate-600 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 mt-2">
                💬 หมายเหตุ: "{order.note}"
              </p>
            )}
          </div>

          {/* Right Column: Qty & Current Stock Badge */}
          <div className="md:col-span-4 flex md:flex-col items-center md:items-end justify-between md:justify-center p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              จำนวนสั่งซื้อ
            </span>
            <div className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isPending ? 'text-amber-600 dark:text-amber-400' : isConfirmed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'
            }`}>
              {order.qty}{' '}
              <span className="text-sm font-bold text-slate-500 dark:text-slate-400">{order.unit}</span>
            </div>
            {order.currentQty !== undefined && (
              <div className="text-[11px] text-slate-400 mt-0.5">
                คงเหลือตอนสั่ง: <span className="font-bold text-rose-500">{order.currentQty} {order.unit}</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="pt-3.5 mt-3.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Resend LINE Notification Button - ONLY for pending orders */}
            {isPending && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => handleResend(order)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
                title="ส่งการแจ้งเตือนและการ์ดยืนยันไปยัง LINE อีกครั้ง"
              >
                <Send className="w-3.5 h-3.5 text-emerald-500" />
                <span>แจ้งเตือน LINE</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* If Pending: Admin can Confirm & Cancel; Staff/User sees Pending Approval badge */}
            {isPending && (
              <>
                {currentUser?.role === 'admin' ? (
                  <>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleQuickCancel(order)}
                      className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleQuickConfirm(order.id)}
                      className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>✅ ยืนยันการสั่งซื้อ</span>
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-400/40 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                    <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                    <span>คำขอรอยืนยัน (เฉพาะ Admin อนุมัติได้)</span>
                  </div>
                )}
              </>
            )}

            {/* If Confirmed: Both Admin and Staff can Receive Goods & Auto Stock In */}
            {isConfirmed && (
              <>
                {currentUser?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleQuickCancel(order)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                )}

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleOpenReceive(order)}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-indigo-500/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <Boxes className="w-4 h-4" />
                  <span>📦 รับสินค้าเข้าคลัง (Stock In)</span>
                </button>
              </>
            )}

            {/* If Received: Completed Indicator */}
            {isReceived && (
              <span className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/50 px-3 py-1 rounded-xl border border-blue-200 dark:border-blue-900/50">
                <Check className="w-4 h-4 stroke-[3]" />
                <span>บันทึกเข้าสต็อกเรียบร้อยแล้ว</span>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 p-3.5 sm:p-5 md:p-6 pb-28 sm:pb-32 max-w-7xl mx-auto w-full min-w-0 overflow-x-hidden">
      {/* Top Banner & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-gradient-to-r from-orange-500/12 via-amber-400/10 to-sky-500/10 p-4 sm:p-5 rounded-[24px] border border-orange-300/80 dark:border-orange-500/40 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                รายการที่ถูกสั่งซื้อ (Purchase Orders)
              </h2>
              {pendingCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500 text-white animate-pulse shadow-sm">
                  รอยืนยัน {pendingCount} รายการ
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              แยกส่วนรอยืนยันและยืนยันแล้วชัดเจน เพื่อการตรวจสอบและรับของเข้าคลังที่รวดเร็ว
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-center">
          {onOpenCreateOrder && (
            <button
              type="button"
              onClick={() => onOpenCreateOrder(null)}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black flex items-center gap-1.5 shadow-md shadow-orange-500/25 transition-all active:scale-95 cursor-pointer shrink-0 border border-amber-300/40"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>ขอสั่งซื้อสินค้า (สั่งของ)</span>
            </button>
          )}

          {onOpenReportModal && currentUser?.role === 'admin' && (
            <button
              type="button"
              onClick={() => onOpenReportModal('purchase_orders')}
              className="px-3.5 py-2 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-rose-500/20 transition-all active:scale-95 cursor-pointer shrink-0 border border-rose-400/40"
              title="ออกรายงานสรุปและประวัติการสั่งซื้อสินค้า (PDF)"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>ออกรายงาน PDF</span>
            </button>
          )}

          {onOpenLineSettings && currentUser?.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenLineSettings}
              className="px-3.5 py-2 rounded-2xl bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 border border-amber-300/60 dark:border-amber-700/60 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all active:scale-95 cursor-pointer shrink-0"
            >
              <span>🎯</span>
              <span>ตั้งค่า LINE สั่งของ</span>
            </button>
          )}
        </div>
      </div>

      {/* Success Notification Alert */}
      {actionSuccessMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs transition-all animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 w-full min-w-0">
        {/* 1. All Orders */}
        <div 
          onClick={() => setActiveTab('all_sections')}
          className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer ${
            activeTab === 'all_sections'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-800 shadow-md ring-2 ring-slate-400/40'
              : 'liquid-glass-card border-slate-200 dark:border-slate-700/80 hover:border-slate-400/60 shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold opacity-80 flex items-center justify-between">
            <span>ทั้งหมด</span>
            <Inbox className="w-3.5 h-3.5" />
          </div>
          <div className="text-xl sm:text-2xl font-black mt-0.5">{orders.length}</div>
          <div className="text-[10px] opacity-70 mt-0.5">แบ่งตามขั้นตอน</div>
        </div>

        {/* 2. Pending Orders */}
        <div 
          onClick={() => setActiveTab('pending')}
          className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer ${
            activeTab === 'pending'
              ? 'bg-amber-500 text-white border-amber-400 shadow-md ring-2 ring-amber-300/40'
              : 'liquid-glass-card border-slate-200 dark:border-slate-700/80 hover:border-amber-400 shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold opacity-80 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>รอยืนยันสั่งซื้อ</span>
            </span>
            {pendingCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />}
          </div>
          <div className={`text-xl sm:text-2xl font-black mt-0.5 ${activeTab !== 'pending' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
            {pendingCount}
          </div>
          <div className="text-[10px] opacity-70 mt-0.5">รออนุมัติ / ยืนยัน</div>
        </div>

        {/* 3. Confirmed Orders */}
        <div 
          onClick={() => setActiveTab('confirmed')}
          className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer ${
            activeTab === 'confirmed'
              ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-2 ring-emerald-300/40'
              : 'liquid-glass-card border-slate-200 dark:border-slate-700/80 hover:border-emerald-400 shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold opacity-80 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Truck className="w-3 h-3" />
              <span>ยืนยันแล้ว</span>
            </span>
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <div className={`text-xl sm:text-2xl font-black mt-0.5 ${activeTab !== 'confirmed' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
            {confirmedCount}
          </div>
          <div className="text-[10px] opacity-70 mt-0.5">รอสินค้ามาส่งเข้าคลัง</div>
        </div>

        {/* 4. Received / Stocked In */}
        <div 
          onClick={() => setActiveTab('received')}
          className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer ${
            activeTab === 'received'
              ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-2 ring-blue-300/40'
              : 'liquid-glass-card border-slate-200 dark:border-slate-700/80 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[11px] font-semibold opacity-80 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Boxes className="w-3 h-3" />
              <span>รับเข้าคลังแล้ว</span>
            </span>
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
          <div className={`text-xl sm:text-2xl font-black mt-0.5 ${activeTab !== 'received' ? 'text-blue-600 dark:text-blue-400' : ''}`}>
            {receivedCount}
          </div>
          <div className="text-[10px] opacity-70 mt-0.5">เติมสต็อกสำเร็จ</div>
        </div>
      </div>

      {/* Search & Navigation Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาตามรหัสคำสั่งซื้อ, รหัสอะไหล่, ชื่อสินค้า, ผู้สั่ง, ร้านค้า..."
            className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              ล้าง
            </button>
          )}
        </div>

        {/* View Selection Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('all_sections')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'all_sections'
                ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-2xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>แยก 2 ส่วนหลัก</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'pending'
                ? 'bg-amber-500 text-white shadow-2xs'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>รอยืนยัน ({pendingCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('confirmed')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'confirmed'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>ยืนยันแล้ว ({confirmedCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('received')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'received'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>รับเข้าแล้ว ({receivedCount})</span>
          </button>

          {cancelledCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('cancelled')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                activeTab === 'cancelled'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>ยกเลิก ({cancelledCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          MAIN SECTION 1: SECTIONS SPLIT VIEW (ALL SECTIONS MODE)
          ===================================================================== */}
      {activeTab === 'all_sections' && (
        <div className="space-y-6">
          {/* SECTION A: ⏳ รายการที่รอยืนยันสั่งซื้อ (Pending Confirmation) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 bg-amber-500/10 dark:bg-amber-950/30 p-3 sm:p-3.5 rounded-2xl border border-amber-400/40 dark:border-amber-700/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-amber-200 flex items-center gap-2">
                    <span>1. รายการที่รอยืนยันสั่งซื้อ (Pending Approval)</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-black bg-amber-500 text-white">
                      {pendingOrders.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    รายการที่ขอสั่งซื้อใหม่ ต้องได้รับการอนุมัติทางเว็บหรือกดผ่านแชท LINE
                  </p>
                </div>
              </div>

              {pendingOrders.length > 0 && (
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 hidden sm:inline">
                  ⚡ ต้องดำเนินการ
                </span>
              )}
            </div>

            {pendingOrders.length === 0 ? (
              <div className="p-8 text-center bg-white/60 dark:bg-slate-900/40 rounded-2xl border border-dashed border-amber-300/60 dark:border-amber-800/60">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  ไม่มีรายการคำสั่งซื้อที่ค้างรอยืนยัน
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  เมื่อมีรายการสั่งซื้อเข้ามาใหม่ จะแสดงในการ์ดด้านบนนี้ทันที
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {pendingOrders.map(renderOrderCard)}
              </div>
            )}
          </div>

          {/* SECTION B: 🚚 รายการที่ยืนยันแล้ว / รอรับเข้าคลัง (Confirmed & In Progress) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-3 bg-emerald-500/10 dark:bg-emerald-950/30 p-3 sm:p-3.5 rounded-2xl border border-emerald-400/40 dark:border-emerald-700/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-600 text-white shadow-xs">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-emerald-200 flex items-center gap-2">
                    <span>2. รายการที่ยืนยันแล้ว / รอรับของเข้าคลัง (Confirmed & Delivering)</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-black bg-emerald-600 text-white">
                      {confirmedOrders.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    อนุมัติการสั่งซื้อแล้ว เมื่อพัสดุมาส่งให้กดปุ่ม "รับสินค้าเข้าคลัง" เพื่อเพิ่มสต็อกอัตโนมัติ
                  </p>
                </div>
              </div>

              {confirmedOrders.length > 0 && (
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hidden sm:inline">
                  📦 พร้อมตรวจรับ
                </span>
              )}
            </div>

            {confirmedOrders.length === 0 ? (
              <div className="p-8 text-center bg-white/60 dark:bg-slate-900/40 rounded-2xl border border-dashed border-emerald-300/60 dark:border-emerald-800/60">
                <Boxes className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-60" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  ไม่มีรายการที่รอนำเข้าคลังในขณะนี้
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  เมื่อกดยืนยันคำสั่งซื้อ รายการจะถูกย้ายมาที่ส่วนนี้เพื่อรอการตรวจรับสินค้า
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {confirmedOrders.map(renderOrderCard)}
              </div>
            )}
          </div>

          {/* SECTION C (COLLAPSIBLE): 📦 ประวัติการตรวจรับเข้าคลัง & รายการยกเลิก */}
          {(receivedOrders.length > 0 || cancelledOrders.length > 0) && (
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-750 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-500" />
                  <span>ประวัติรายการที่เสร็จสมบูรณ์แล้ว ({receivedOrders.length + cancelledOrders.length} รายการ)</span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 text-[11px]">
                  <span>{showHistory ? 'ซ่อนประวัติ' : 'ดูประวัติ'}</span>
                  {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {showHistory && (
                <div className="pt-3.5 space-y-3 animate-in fade-in duration-150">
                  {receivedOrders.map(renderOrderCard)}
                  {cancelledOrders.map(renderOrderCard)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB VIEW: SPECIFIC STATUS FILTER SELECTED
          ===================================================================== */}
      {activeTab !== 'all_sections' && (
        <div className="space-y-3.5">
          {(() => {
            const currentList = 
              activeTab === 'pending' ? pendingOrders :
              activeTab === 'confirmed' ? confirmedOrders :
              activeTab === 'received' ? receivedOrders : cancelledOrders;

            if (currentList.length === 0) {
              return (
                <div className="p-12 text-center liquid-glass-card rounded-3xl border border-white/60 dark:border-white/10">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
                    <ShoppingCart className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-white">
                    {searchTerm ? 'ไม่พบรายการที่ตรงกับเงื่อนไขค้นหา' : 'ยังไม่มีรายการในหมวดหมู่นี้'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                    คุณสามารถสลับไปยังแท็บอื่น หรือกด "แยก 2 ส่วนหลัก" เพื่อดูภาพรวมทั้งหมด
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 gap-3.5">
                {currentList.map(renderOrderCard)}
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================
          RECEIVE GOODS & AUTO STOCK-IN MODAL
          ======================================================== */}
      {receivingOrder && (
        <ModalPortal>
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-150">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    ตรวจรับสินค้าเข้าคลัง (Stock In)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ระบบจะเพิ่มยอดคงเหลือในคลังและสร้างบันทึกรับเข้าให้อัตโนมัติ
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-1.5 mb-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">ใบสั่งซื้อ:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-white">{receivingOrder.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">สินค้า:</span>
                  <span className="font-bold text-slate-800 dark:text-white">{receivingOrder.itemName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">รหัสอะไหล่:</span>
                  <span className="font-mono text-slate-600 dark:text-slate-300">{receivingOrder.itemId}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    จำนวนที่รับจริง ({receivingOrder.unit}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(e.target.value)}
                    className="w-full text-xl font-black text-indigo-600 dark:text-indigo-400 px-3.5 py-2 rounded-xl border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    บันทึกเพิ่มเติม
                  </label>
                  <input
                    type="text"
                    value={receiveNote}
                    onChange={(e) => setReceiveNote(e.target.value)}
                    className="w-full text-xs px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="เช่น ตรวจรับเรียบร้อย สินค้าสมบูรณ์"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-5">
                <button
                  type="button"
                  onClick={() => setReceivingOrder(null)}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  ยกเลิก
                </button>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleConfirmReceive}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs shadow-md shadow-indigo-500/25 flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>กำลังอัปเดตสต็อก...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>ยืนยันรับของเข้าคลัง</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
