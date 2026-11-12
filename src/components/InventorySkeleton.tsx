import React from 'react';
import { motion } from 'motion/react';

interface InventorySkeletonProps {
  count?: number;
}

export const InventorySkeleton: React.FC<InventorySkeletonProps> = ({ count = 8 }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5 sm:gap-3">
      {Array.from({ length: count }).map((_, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: idx * 0.03 }}
          className="bg-white dark:bg-[#101826] border border-slate-200/80 dark:border-white/10 rounded-2xl p-3.5 sm:p-4 shadow-sm relative overflow-hidden"
        >
          <div className="space-y-2">
            {/* Top row */}
            <div className="flex items-center justify-between gap-2">
              <div className="w-24 h-5 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="w-16 h-5 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>

            {/* Title & Metadata */}
            <div className="space-y-1.5 pt-0.5">
              <div className="w-4/5 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="w-3/5 h-3 bg-slate-100 dark:bg-slate-800/70 rounded animate-pulse" />
            </div>

            {/* Bottom bar */}
            <div className="pt-2.5 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="w-20 h-6 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="w-20 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
