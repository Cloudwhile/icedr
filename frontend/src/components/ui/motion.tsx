"use client";

import { AnimatePresence, LayoutGroup, motion, stagger, useAnimate, type Transition, type Variants } from "framer-motion";
import { useCallback, useEffect, type ComponentProps, type DependencyList, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

export type MotionPreset = "fade" | "surface" | "panel-left" | "panel-right" | "toolbar" | "dialog" | "menu" | "overlay" | "toast" | "list" | "drawer" | "pressable";

type MotionSpec = {
  enter: Record<string, number | string>;
  exit: Record<string, number | string>;
  initial: Record<string, number | string>;
  transition: Transition;
};

const motionSpecs: Record<MotionPreset, MotionSpec> = {
  dialog: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.99, y: 6 },
    initial: { opacity: 0, scale: 0.99, y: 8 },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
  fade: {
    enter: { opacity: 1 },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
    transition: { duration: 0.16, ease: [0.2, 0, 0, 1] },
  },
  drawer: {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
    initial: { opacity: 0, x: -24 },
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  list: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 1, y: 4 },
    initial: { opacity: 0, scale: 1, y: 6 },
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  menu: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 1, y: -2 },
    initial: { opacity: 0, scale: 1, y: -3 },
    transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
  },
  overlay: {
    enter: { opacity: 1 },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
    transition: { duration: 0.16, ease: [0.2, 0, 0, 1] },
  },
  "panel-left": {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
    initial: { opacity: 0, x: -24 },
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  "panel-right": {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 16 },
    initial: { opacity: 0, x: 24 },
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  pressable: {
    enter: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.985 },
    initial: { opacity: 0, scale: 0.985 },
    transition: { duration: 0.18, ease: [0.2, 0, 0, 1] },
  },
  surface: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 1, y: 4 },
    initial: { opacity: 0, scale: 1, y: 6 },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
  toast: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 1, y: 6 },
    initial: { opacity: 0, scale: 1, y: 10 },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
  toolbar: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 1, y: 4 },
    initial: { opacity: 0, scale: 1, y: 6 },
    transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  },
};

function variantsFor(preset: MotionPreset, reduce: boolean): Variants {
  const spec = motionSpecs[preset];
  if (reduce) {
    return {
      enter: spec.enter,
      exit: { ...spec.enter, opacity: 0 },
      initial: spec.enter,
    };
  }
  return {
    enter: spec.enter,
    exit: spec.exit,
    initial: spec.initial,
  };
}

export function MotionPresence({
  children,
  preset = "fade",
  show,
  ...rest
}: {
  children: ReactNode;
  preset?: MotionPreset;
  show: boolean;
} & Omit<ComponentProps<typeof motion.div>, "animate" | "children" | "exit" | "initial" | "variants">) {
  const reduce = usePrefersReducedMotion();
  const spec = motionSpecs[preset];

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          animate="enter"
          exit="exit"
          initial="initial"
          transition={reduce ? { duration: 0 } : spec.transition}
          variants={variantsFor(preset, Boolean(reduce))}
          {...rest}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function MotionSurface({
  children,
  preset = "surface",
  ...rest
}: {
  children: ReactNode;
  preset?: MotionPreset;
} & Omit<ComponentProps<typeof motion.div>, "animate" | "children" | "exit" | "initial" | "variants">) {
  const reduce = usePrefersReducedMotion();
  const spec = motionSpecs[preset];

  return (
    <motion.div
      animate="enter"
      exit="exit"
      initial="initial"
      transition={reduce ? { duration: 0 } : spec.transition}
      variants={variantsFor(preset, Boolean(reduce))}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function MotionList({
  children,
  containerRef,
  style,
  ...rest
}: {
  children: ReactNode;
  containerRef?: (node: HTMLDivElement | null) => void;
  preset?: MotionPreset;
} & Omit<ComponentProps<typeof motion.div>, "animate" | "children" | "exit" | "initial" | "variants">) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    containerRef?.(scope.current);
    return () => containerRef?.(null);
  }, [containerRef, scope]);

  useEffect(() => {
    const node = scope.current;
    if (!node) return;
    const targets = Array.from(node.querySelectorAll<HTMLElement>("[data-motion-row]"));
    if (targets.length === 0) return;
    if (reduce) {
      void animate(targets, { opacity: 1, y: 0 }, { duration: 0 });
      return;
    }

    const animation = animate(
      targets,
      { opacity: [0, 1], y: [4, 0] },
      {
        // Keep the whole list within a 200 ms entrance budget.
        delay: stagger(0.02 / Math.max(1, targets.length - 1)),
        duration: 0.18,
        ease: [0.16, 1, 0.3, 1],
      },
    );
    return () => animation.stop();
  }, [animate, reduce, scope]);

  return (
    <motion.div
      ref={scope}
      style={{ opacity: 1, ...style }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function useMotionReveal<T extends HTMLElement>(preset: MotionPreset, deps: DependencyList) {
  const [scope, animate] = useAnimate<T>();
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    if (!scope.current) return;
    const spec = motionSpecs[preset];
    if (reduce) {
      void animate(scope.current, spec.enter, { duration: 0 });
      return;
    }
    const keyframes = Object.fromEntries(Object.entries(spec.enter).map(([property, value]) => [property, [spec.initial[property], value]]));
    const animation = animate(scope.current, keyframes, spec.transition);
    return () => animation.stop();
    // The caller owns the reveal trigger dependencies, mirroring the old animation hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, preset, reduce, scope, ...deps]);

  return scope;
}

export function useMotionMount<T extends HTMLElement>(preset: MotionPreset) {
  const [, animate] = useAnimate<T>();
  const reduce = usePrefersReducedMotion();

  return useCallback(
    (node: T | null) => {
      if (!node) return;
      const spec = motionSpecs[preset];
      if (reduce) {
        void animate(node, spec.enter, { duration: 0 });
        return;
      }
      const keyframes = Object.fromEntries(Object.entries(spec.enter).map(([property, value]) => [property, [spec.initial[property], value]]));
      void animate(node, keyframes, spec.transition);
    },
    [animate, preset, reduce],
  );
}

export function useMotionStagger<T extends HTMLElement>(deps: DependencyList, selector = "[data-motion-row]") {
  const [scope, animate] = useAnimate<T>();
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    const node = scope.current;
    if (!node) return;
    const targets = Array.from(node.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;
    if (reduce) {
      void animate(targets, { opacity: 1, y: 0 }, { duration: 0 });
      return;
    }
    const animation = animate(targets, { opacity: [0, 1], y: [4, 0] }, {
      delay: stagger(0.02 / Math.max(1, targets.length - 1)),
      duration: 0.18,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => animation.stop();
    // The caller owns the stagger trigger dependencies, mirroring the old animation hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, reduce, scope, selector, ...deps]);

  return scope;
}

export const MotionLayoutGroup = LayoutGroup;
export { motion };
