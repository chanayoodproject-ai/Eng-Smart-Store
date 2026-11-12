import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Package, BarChart3, Bot, ClipboardList, Layers, ShieldCheck, ShoppingCart } from 'lucide-react';

export type AppTab = 'inventory' | 'history' | 'orders' | 'voice' | 'dashboard' | 'categories' | 'admin' | 'users';

interface MobileNavbarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  lowStockCount?: number;
  requisitionCount?: number;
  pendingOrdersCount?: number;
  isAdmin?: boolean;
  isLiveActive?: boolean;
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  dot?: boolean;
  isCenter?: boolean;
  isUrgent?: boolean;
}

export const MobileNavbar: React.FC<MobileNavbarProps> = ({
  activeTab,
  setActiveTab,
  lowStockCount = 0,
  requisitionCount = 0,
  pendingOrdersCount = 0,
  isAdmin = false,
  isLiveActive = false,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const tabs: NavItem[] = isAdmin
    ? [
        { id: 'inventory', label: 'อะไหล่', icon: Package },
        { id: 'history', label: 'เบิก/รับ', icon: ClipboardList, badge: requisitionCount },
        { id: 'categories', label: 'หมวด', icon: Layers },
        { id: 'voice', label: isLiveActive ? 'คุยสด AI' : 'ถาม AI', icon: Bot, isCenter: true },
        { id: 'orders', label: 'สั่งของ', icon: ShoppingCart, badge: pendingOrdersCount, isUrgent: pendingOrdersCount > 0 },
        { id: 'dashboard', label: 'ภาพรวม', icon: BarChart3, dot: lowStockCount > 0 },
        { id: 'admin', label: 'Admin', icon: ShieldCheck },
      ]
    : [
        { id: 'inventory', label: 'อะไหล่', icon: Package },
        { id: 'history', label: 'เบิก/รับ', icon: ClipboardList, badge: requisitionCount },
        { id: 'voice', label: isLiveActive ? 'คุยสด AI' : 'ถาม AI', icon: Bot, isCenter: true },
        { id: 'orders', label: 'สั่งของ', icon: ShoppingCart, badge: pendingOrdersCount, isUrgent: pendingOrdersCount > 0 },
        { id: 'dashboard', label: 'ภาพรวม', icon: BarChart3, dot: lowStockCount > 0 },
      ];

  const navContent = (
    <nav 
      aria-label="เมนูหลักด้านล่าง"
      style={{
        position: 'fixed',
        bottom: 'max(6px, calc(env(safe-area-inset-bottom, 0px) * 0.4 + 4px))',
        left: '50%',
        transform: 'translateX(-50%)',
        WebkitTransform: 'translateX(-50%)',
        paddingBottom: 'max(4px, calc(env(safe-area-inset-bottom, 0px) * 0.3 + 2px))',
        paddingLeft: 'max(8px, env(safe-area-inset-left, 6px))',
        paddingRight: 'max(8px, env(safe-area-inset-right, 6px))',
        zIndex: 60,
      }}
      className="xl:hidden flex w-[calc(100%-16px)] sm:w-[calc(100%-28px)] max-w-lg sm:max-w-xl md:max-w-2xl bg-white/92 dark:bg-[#0d1422]/92 backdrop-blur-xl rounded-[22px] px-1.5 sm:px-2.5 pt-1 items-center justify-around shadow-[0_16px_40px_-16px_rgba(15,23,42,0.45)] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] border border-white/80 dark:border-white/10 pointer-events-auto select-none"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id || (tab.id === 'admin' && activeTab === 'users');

        if (tab.isCenter) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="relative -top-3.5 sm:-top-4 flex flex-col items-center justify-center transition-transform active:scale-95 px-1 cursor-pointer shrink-0"
              aria-label={tab.label}
            >
              {isLiveActive && (
                <span className="absolute -top-1 right-0 flex h-3.5 w-3.5 z-20">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 ring-2 ring-white dark:ring-slate-900"></span>
                </span>
              )}
              <motion.div
                whileTap={{ scale: 0.92 }}
                className={`w-12 h-12 sm:w-[52px] sm:h-[52px] rounded-2xl flex items-center justify-center shadow-lg transition-colors duration-150 relative border ${
                  isLiveActive
                    ? 'bg-red-600 text-white border-red-400 ring-2 ring-red-500/30'
                    : isActive
                    ? 'bg-gradient-to-br from-blue-600 to-sky-400 text-white border-transparent ring-2 ring-orange-400/80'
                    : 'bg-slate-950 dark:bg-gradient-to-br dark:from-blue-600 dark:to-sky-500 text-white border-slate-800 dark:border-transparent ring-2 ring-orange-400/50'
                }`}
              >
                <Icon className="w-5.5 h-5.5 relative z-10" />
              </motion.div>
              <span
                className={`text-[10px] sm:text-[11px] font-bold mt-0.5 tracking-tight ${
                  isLiveActive
                    ? 'text-red-600 dark:text-red-400'
                    : isActive
                    ? 'text-blue-600 dark:text-blue-400 font-extrabold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center py-1.5 px-0.5 rounded-2xl relative transition-colors duration-150 cursor-pointer min-h-[48px] active:scale-95 ${
              isActive
                ? 'text-blue-700 dark:text-blue-300 font-bold bg-blue-50 dark:bg-blue-500/15'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            aria-label={tab.label}
          >
            <Icon className={`w-4.5 h-4.5 sm:w-5 sm:h-5 mb-0.5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.9]'}`} />
            <span className={`text-[10px] sm:text-[11px] tracking-tight whitespace-nowrap ${isActive ? 'font-bold text-blue-600 dark:text-blue-400' : 'font-medium'}`}>
              {tab.label}
            </span>

            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                className={`absolute top-0.5 right-1 px-1 min-w-[15px] h-3.5 text-[9px] font-mono font-bold tabular-nums text-white rounded flex items-center justify-center ring-1 ring-white dark:ring-slate-900 ${
                  tab.isUrgent ? 'bg-orange-600' : 'bg-slate-600 dark:bg-slate-700'
                }`}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}

            {tab.dot && (
              <span className="absolute top-1 right-1.5 w-2 h-2 bg-amber-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
            )}
          </button>
        );
      })}
    </nav>
  );

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(navContent, document.body);
};
