import React from 'react';
import { motion } from 'motion/react';
import { InventoryItem } from '../types';
import { MapPin, AlertTriangle, Check, ShoppingCart, Star, Zap } from 'lucide-react';

interface ItemCardProps {
  item: InventoryItem;
  onClick: (item: InventoryItem) => void;
  index?: number;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (item: InventoryItem) => void;
  onLongPress?: (item: InventoryItem) => void;
  isRecentlyUpdated?: boolean;
  isLowSpec?: boolean;
  onOrderClick?: (item: InventoryItem) => void;
  onQuickRequisition?: (item: InventoryItem) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (item: InventoryItem) => void;
}

export const ItemCard: React.FC<ItemCardProps> = React.memo(({ 
  item, 
  onClick, 
  index = 0,
  isMultiSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onLongPress,
  isRecentlyUpdated = false,
  isLowSpec = false,
  onOrderClick,
  onQuickRequisition,
  isFavorite = false,
  onToggleFavorite,
}) => {
  // Long press detection for selecting multiple items
  const longPressTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const isLongPressTriggeredRef = React.useRef(false);
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    isLongPressTriggeredRef.current = false;

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if (onLongPress) {
        onLongPress(item);
      } else if (onToggleSelect) {
        onToggleSelect(item);
      }
    }, 450);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPosRef.current || !longPressTimerRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 8 || dy > 8) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    startPosRef.current = null;
  };

  const handlePointerCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    startPosRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLongPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const isOut = item.status === 'out' || item.qty <= 0;
  const isLow = !isOut && (item.status === 'low' || item.qty <= item.minStock);

  // Industrial Command Pro precision status configuration
  const getStatusConfig = () => {
    if (isOut) {
      return {
        borderClass: isSelected
          ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/30'
          : 'border-red-300 dark:border-red-800/80 hover:border-red-500 dark:hover:border-red-600',
        qtyColor: 'text-red-600 dark:text-red-400',
        statusPill: (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/70">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-red-400 shrink-0" />
            <span>หมดสต๊อก</span>
          </span>
        ),
      };
    }
    if (isLow) {
      return {
        borderClass: isSelected
          ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/30'
          : 'border-amber-300 dark:border-amber-800/80 hover:border-amber-500 dark:hover:border-amber-600',
        qtyColor: 'text-amber-600 dark:text-amber-400',
        statusPill: (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/70">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>ใกล้หมด</span>
          </span>
        ),
      };
    }
    return {
      borderClass: isSelected
        ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/30'
        : isFavorite
          ? 'border-amber-300 dark:border-amber-700/80 hover:border-amber-400'
          : 'border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500',
      qtyColor: 'text-emerald-600 dark:text-emerald-400',
      statusPill: (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span>พร้อมเบิก</span>
        </span>
      ),
    };
  };

  const statusConfig = getStatusConfig();

  const handleCardClick = (e: React.MouseEvent) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }
    if (isMultiSelectMode && onToggleSelect) {
      e.stopPropagation();
      onToggleSelect(item);
    } else {
      onClick(item);
    }
  };

  const staggerDelay = isLowSpec
    ? Math.min(index * 0.01, 0.08)
    : Math.min(index * 0.018, 0.22);

  const daysOut = React.useMemo(() => {
    if (!isOut || !item.outOfStockDate) return null;
    const diff = Date.now() - new Date(item.outOfStockDate).getTime();
    if (isNaN(diff)) return null;
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }, [isOut, item.outOfStockDate]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isLowSpec ? undefined : { y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{
        duration: isLowSpec ? 0.16 : 0.24,
        ease: [0.22, 1, 0.36, 1],
        delay: staggerDelay,
      }}
      onClick={handleCardClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
      className={`item-card-container w-full min-w-0 max-w-full box-border rounded-2xl p-3.5 sm:p-4 transition-all duration-150 cursor-pointer relative group flex flex-col justify-between overflow-hidden select-none touch-manipulation border bg-white dark:bg-[#101826] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-22px_rgba(15,23,42,0.55)] hover:shadow-[0_12px_28px_-16px_rgba(37,99,235,0.35)] ${
        isSelected
          ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-600 dark:border-blue-400 ring-2 ring-blue-500/30'
          : isRecentlyUpdated
            ? `${statusConfig.borderClass} ring-2 ring-emerald-500/30`
            : statusConfig.borderClass
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-1 ${
          isSelected ? 'bg-blue-600' : isOut ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
        }`}
      />
      {/* Top Section: Code + Favorite + Status Indicator */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {isMultiSelectMode && (
              <button
                type="button"
                aria-label={isSelected ? `ยกเลิกเลือก ${item.name}` : `เลือก ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleSelect) onToggleSelect(item);
                }}
                className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  isSelected
                    ? 'bg-blue-600 text-white border border-blue-600'
                    : 'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-transparent hover:border-blue-500'
                }`}
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </button>
            )}

            <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md border border-slate-200/80 dark:border-white/10 tabular-nums tracking-tight">
              {item.id}
            </span>

            {item.ordered && (
              <span
                className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60 truncate max-w-[90px]"
                title={item.ordered}
              >
                ✓ สั่งซื้อแล้ว
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onToggleFavorite && (
              <button
                type="button"
                aria-label={isFavorite ? `ยกเลิกปักหมุด ${item.name}` : `ปักหมุดรายการโปรด ${item.name}`}
                title={isFavorite ? 'เลิกปักหมุดรายการโปรด' : 'ปักหมุดเป็นรายการโปรด'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(item);
                }}
                className={`w-9 h-9 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                  isFavorite
                    ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/50'
                    : 'text-slate-400 hover:text-amber-500 dark:text-slate-500 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-500' : ''}`} />
              </button>
            )}
            {statusConfig.statusPill}
          </div>
        </div>

        {/* Item Name */}
        <h3 className="font-bold text-slate-950 dark:text-slate-50 text-[15px] sm:text-base leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {item.name}
        </h3>

        {/* Unboxed Technical Metadata Line (Category · Location · Min Stock) */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap leading-tight">
          <span className="font-semibold text-slate-700 dark:text-slate-300">{item.category}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
            <MapPin className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate max-w-[140px]">{item.location || 'Store FL.6'}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="tabular-nums">
            เกณฑ์ <strong className="font-semibold text-slate-700 dark:text-slate-300">{item.minStock}</strong> {item.unit}
          </span>
        </div>

        {/* Concise Out-of-Stock Duration Line */}
        {isOut && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>
              {daysOut !== null
                ? `ขาดสต๊อกมาแล้ว ${daysOut} วัน`
                : 'สินค้าหมดสต๊อก รอสั่งซื้อเติมคลัง'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Action & Telemetry Bar: Large Tabular Stock + 1-Click Quick Actions */}
      <div className="flex items-end justify-between pt-2.5 mt-2.5 border-t border-slate-100 dark:border-slate-800/90 gap-2">
        {/* Left: High-Contrast Stock Counter */}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">คงเหลือ</span>
          <span className={`font-mono font-black text-2xl sm:text-[1.7rem] tabular-nums tracking-tight leading-none ${statusConfig.qtyColor}`}>
            {item.qty.toLocaleString()}
          </span>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 truncate">
            {item.unit}
          </span>
        </div>

        {/* Right: 1-Click Action Buttons (Order & Quick Requisition) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(isOut || isLow) && onOrderClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOrderClick(item);
              }}
              className={`h-10 px-3 rounded-xl font-bold text-xs inline-flex items-center gap-1 transition-all active:scale-95 cursor-pointer border ${
                isOut
                  ? 'bg-red-600 hover:bg-red-700 text-white border-red-600 shadow-2xs'
                  : 'bg-orange-50 dark:bg-orange-950/60 hover:bg-orange-100 dark:hover:bg-orange-900/70 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800'
              }`}
              title={`สร้างใบสั่งซื้อ ${item.name}`}
            >
              <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
              <span>สั่งซื้อ</span>
            </button>
          )}

          {onQuickRequisition && (
            <button
              type="button"
              disabled={isOut}
              onClick={(e) => {
                e.stopPropagation();
                if (!isOut) {
                  onQuickRequisition(item);
                }
              }}
              className={`h-10 px-3.5 rounded-xl font-bold text-xs inline-flex items-center gap-1 transition-all cursor-pointer ${
                isOut
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95 text-white border border-blue-600 shadow-2xs'
              }`}
              title={isOut ? 'สินค้าหมด ไม่สามารถเบิกได้' : `เบิกด่วน ${item.name} ในคลิกเดียว`}
            >
              <Zap className="w-3.5 h-3.5 shrink-0 fill-current" />
              <span>เบิกด่วน</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

ItemCard.displayName = 'ItemCard';
