"use client";

import { AnimatePresence, LayoutGroup, motion, stagger, useAnimate, useReducedMotion, type Transition, type Variants } from "framer-motion";
import { useCallback, useEffect, type ComponentProps, type DependencyList, type ReactNode } from "react";

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
    exit: { opacity: 0, scale: 0.975, y: 10 },
    initial: { opacity: 0, scale: 0.965, y: 18 },
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
  fade: {
    enter: { opacity: 1 },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
    transition: { duration: 0.2, ease: [0.2, 0, 0, 1] },
  },
  drawer: {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -24 },
    initial: { opacity: 0, x: -32 },
    transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] },
  },
  list: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.992, y: 8 },
    initial: { opacity: 0, scale: 0.992, y: 10 },
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  menu: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.985, y: -3 },
    initial: { opacity: 0, scale: 0.975, y: -4 },
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  },
  overlay: {
    enter: { opacity: 1 },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
    transition: { duration: 0.28, ease: [0.2, 0, 0, 1] },
  },
  "panel-left": {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -24 },
    initial: { opacity: 0, x: -30 },
    transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
  },
  "panel-right": {
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 28 },
    initial: { opacity: 0, x: 34 },
    transition: { duration: 0.44, ease: [0.16, 1, 0.3, 1] },
  },
  pressable: {
    enter: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.985 },
    initial: { opacity: 0, scale: 0.985 },
    transition: { duration: 0.18, ease: [0.2, 0, 0, 1] },
  },
  surface: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.995, y: 8 },
    initial: { opacity: 0, scale: 0.992, y: 12 },
    transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] },
  },
  toast: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: 14 },
    initial: { opacity: 0, scale: 0.975, y: 20 },
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
  },
  toolbar: {
    enter: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.985, y: 10 },
    initial: { opacity: 0, scale: 0.985, y: 12 },
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
};

function variantsFor(preset: MotionPreset, reduce: boolean): Variants {
  const spec = motionSpecs[preset];
  if (reduce) {
    return {
      enter: { opacity: 1 },
      exit: { opacity: 0 },
      initial: { opacity: 0 },
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
  const reduce = useReducedMotion();
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
  const reduce = useReducedMotion();
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
  preset = "list",
  ...rest
}: {
  children: ReactNode;
  preset?: MotionPreset;
} & Omit<ComponentProps<typeof motion.div>, "animate" | "children" | "exit" | "initial" | "variants">) {
  return (
    <MotionSurface layout preset={preset} {...rest}>
      {children}
    </MotionSurface>
  );
}

export function useMotionReveal<T extends HTMLElement>(preset: MotionPreset, deps: DependencyList) {
  const [scope, animate] = useAnimate<T>();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!scope.current) return;
    const spec = motionSpecs[preset];
    if (reduce) {
      void animate(scope.current, { opacity: 1 }, { duration: 0 });
      return;
    }
    void animate(scope.current, [spec.initial, spec.enter], spec.transition);
    // The caller owns the reveal trigger dependencies, mirroring the old animation hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return scope;
}

export function useMotionMount<T extends HTMLElement>(preset: MotionPreset) {
  const [, animate] = useAnimate<T>();
  const reduce = useReducedMotion();

  return useCallback(
    (node: T | null) => {
      if (!node) return;
      const spec = motionSpecs[preset];
      if (reduce) {
        void animate(node, { opacity: 1 }, { duration: 0 });
        return;
      }
      void animate(node, [spec.initial, spec.enter], spec.transition);
    },
    [animate, preset, reduce],
  );
}

export function useMotionStagger<T extends HTMLElement>(deps: DependencyList, selector = "[data-motion-row]") {
  const [scope, animate] = useAnimate<T>();
  const reduce = useReducedMotion();

  useEffect(() => {
    const node = scope.current;
    if (!node) return;
    const targets = Array.from(node.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;
    if (reduce) {
      void animate(targets, { opacity: 1 }, { duration: 0 });
      return;
    }
    void animate(targets, { opacity: [0, 1], scale: [0.992, 1], y: [12, 0] }, { delay: stagger(Math.min(0.038, 0.24 / targets.length)), duration: 0.34, ease: [0.16, 1, 0.3, 1] });
    // The caller owns the stagger trigger dependencies, mirroring the old animation hook API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return scope;
}

export const MotionLayoutGroup = LayoutGroup;
export { motion };
