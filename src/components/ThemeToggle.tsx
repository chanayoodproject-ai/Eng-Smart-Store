import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  className = '',
  showLabel = false 
}) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`eng-icon-btn ${
        isDark
          ? '!bg-amber-400/15 !text-amber-300 !border-amber-300/40'
          : '!bg-indigo-50 !text-indigo-700 !border-indigo-200'
      } ${className}`}
      title={isDark ? 'สลับเป็นโทนสว่าง (Light Mode)' : 'สลับเป็นโทนมืด (Dark Mode)'}
      aria-label="สลับธีม สว่าง/มืด"
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isDark ? (
          <Sun className="w-4 h-4 text-amber-400" />
        ) : (
          <Moon className="w-4 h-4 text-slate-700" />
        )}
      </div>
      {showLabel && (
        <span className="ml-1.5 text-xs font-bold tracking-tight">
          {isDark ? 'โทนมืด' : 'โทนสว่าง'}
        </span>
      )}
    </button>
  );
};
