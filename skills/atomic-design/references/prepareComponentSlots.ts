import { Children, isValidElement, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

type SlotComponent = (props: never) => ReactNode;
type SlotDefinition = SlotComponent | readonly SlotComponent[];
type PreparedSlots = Record<string, ReactElement | ReactElement[] | null>;

export function prepareComponentSlots(
  definitions: Record<string, SlotDefinition>,
): (children: ReactNode) => PreparedSlots {
  const entries = Object.entries(definitions);

  return function usePreparedComponentSlots(children: ReactNode): PreparedSlots {
    return useMemo(() => {
      const preparedSlots: PreparedSlots = {};

      for (const [key, definition] of entries) {
        preparedSlots[key] = Array.isArray(definition) ? [] : null;
      }

      for (const child of Children.toArray(children)) {
        if (!isValidElement(child)) continue;

        const match = entries.find(([, definition]) => {
          const slotComponents = Array.isArray(definition) ? definition : [definition];
          return slotComponents.includes(child.type as SlotComponent);
        });

        if (match == null) continue;

        const [key, definition] = match;

        if (Array.isArray(definition)) {
          (preparedSlots[key] as ReactElement[]).push(child);
          continue;
        }

        preparedSlots[key] = child;
      }

      return preparedSlots;
    }, [children]);
  };
}
