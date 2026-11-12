import React from 'react';
import { Package, ClipboardList, Bot, BarChart3, Layers, ShieldCheck, ShoppingCart } from 'lucide-react';
import { AppTab } from './MobileNavbar';

interface TopNavTabsProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  requisitionCount?: number;
  lowStockCount?: number;
  pendingOrdersCount?: number;
  isAdmin?: boolean;
  isLiveActive?: boolean;
  className?: string;
}

export const TopNavTabs: React.FC<TopNavTabsProps> = ({
  activeTab,
  setActiveTab,
  requisitionCount = 0,
  lowStockCount = 0,
  pendingOrdersCount = 0,
  isAdmin = false,
  isLiveActive = false,
  className = '',
}) => {
  const tabs = [
    { id: 'inventory' as AppTab, label: 'คลังอะไหล่', icon: Package },
    { 
      id: 'history' as AppTab, 
      label: 'เบิก/รับ', 
      icon: ClipboardList, 
      badge: requisitionCount > 0 ? requisitionCount : undefined 
    },
    ...(isAdmin ? [{ id: 'categories' as AppTab, label: 'หมวดหมู่', icon: Layers }] : []),
    { 
      id: 'voice' as AppTab, 
      label: isLiveActive ? 'คุยสด AI' : 'ผู้ช่วย AI', 
      icon: Bot,
      isLive: isLiveActive 
    },
    { 
      id: 'orders' as AppTab, 
      label: 'ใบสั่งซื้อ', 
      icon: ShoppingCart, 
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : undefined,
      isUrgentBadge: pendingOrdersCount > 0
    },
    { 
      id: 'dashboard' as AppTab, 
      label: 'ภาพรวม', 
      icon: BarChart3, 
      dot: lowStockCount > 0 
    },
    ...(isAdmin ? [{ id: 'admin' as AppTab, label: 'ตั้งค่า Admin', icon: ShieldCheck }] : []),
  ];

  return (
    <nav 
      aria-label="Navigation Tabs"
      className={`items-center gap-1 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-md shadow-sm ${className}`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id || (tab.id === 'admin' && activeTab === 'users');

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer select-none relative shrink-0 active:scale-95 min-h-9 ${
              isActive
                ? 'bg-slate-950 text-white shadow-md dark:bg-gradient-to-r dark:from-blue-600 dark:to-sky-500'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
            <span>{tab.label}</span>

            {/* Tabular Badge */}
            {tab.badge !== undefined && (
              <span 
                className={`ml-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold tabular-nums ${
                  isActive 
                    ? 'bg-white/20 text-white' 
                    : tab.isUrgentBadge
                      ? 'bg-orange-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}

            {/* Live active voice indicator */}
            {tab.isLive && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping absolute -top-0.5 -right-0.5" />
            )}

            {/* Alert dot for low stock on dashboard */}
            {tab.dot && !isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute top-1 right-1" />
            )}
          </button>
        );
      })}
    </nav>
  );
};
