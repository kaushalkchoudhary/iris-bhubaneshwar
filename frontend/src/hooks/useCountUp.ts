import { useState, useEffect, useRef } from 'react';

interface UseCountUpOptions {
  duration?: number; // Animation duration in milliseconds
  startValue?: number;
  decimals?: number;
}

export function useCountUp(
  targetValue: number,
  options: UseCountUpOptions = {}
): number {
  const { duration = 1000, startValue = 0, decimals = 0 } = options;
  const [displayValue, setDisplayValue] = useState(startValue);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(startValue);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset when target value changes
    if (targetValue !== startValueRef.current) {
      startValueRef.current = displayValue;
      startTimeRef.current = null;
    }

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const currentValue = startValueRef.current + (targetValue - startValueRef.current) * easeOut;
      
      if (decimals > 0) {
        setDisplayValue(Number(currentValue.toFixed(decimals)));
      } else {
        setDisplayValue(Math.floor(currentValue));
      }

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(targetValue);
        startValueRef.current = targetValue;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [targetValue, duration, decimals]);

  return displayValue;
}
