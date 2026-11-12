import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface GlobalProgressBarProps {
  isLoading: boolean;
  triggerKey?: string | number;
}

export const GlobalProgressBar: React.FC<GlobalProgressBarProps> = ({
  isLoading,
  triggerKey,
}) => {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<NodeJS.Timeout[]>([]);

  const clearTimers = () => {
    timerRef.current.forEach((t) => clearTimeout(t));
    timerRef.current = [];
  };

  const startProgress = () => {
    clearTimers();
    setVisible(true);
    setProgress(15);

    const t1 = setTimeout(() => setProgress(45), 60);
    const t2 = setTimeout(() => setProgress(75), 180);
    const t3 = setTimeout(() => setProgress(90), 320);

    timerRef.current.push(t1, t2, t3);
  };

  const completeProgress = () => {
    clearTimers();
    setProgress(100);
    const t = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 280);
    timerRef.current.push(t);
  };

  // Trigger on external isLoading change
  useEffect(() => {
    if (isLoading) {
      startProgress();
    } else {
      completeProgress();
    }
    return () => clearTimers();
  }, [isLoading]);

  // Trigger quick subtle progress when triggerKey (e.g. activeTab) changes
  useEffect(() => {
    if (triggerKey !== undefined) {
      startProgress();
      const t = setTimeout(() => {
        completeProgress();
      }, 220);
      timerRef.current.push(t);
    }
    return () => clearTimers();
  }, [triggerKey]);

  if (!visible && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[999] h-[3px] pointer-events-none overflow-hidden bg-transparent">
      <motion.div
        className="eng-progress h-full"
        initial={{ width: '0%', opacity: 1 }}
        animate={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
        transition={{
          width: { ease: [0.16, 1, 0.3, 1], duration: progress === 100 ? 0.18 : 0.4 },
          opacity: { duration: 0.28 },
        }}
      />
    </div>
  );
};
