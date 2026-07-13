import { Children, isValidElement, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

export interface PrepareComponentSlotsOptions {
  strict?: boolean;
}

type SlotComponent<Props = never> = (props: Props) => ReactNode;

type SlotDefinition = SlotComponent | readonly SlotComponent[];
type SlotDefinitions = Record<string, SlotDefinition>;

type SlotProps<Component> = Component extends SlotComponent<infer Props> ? Props : never;

type PreparedSlot<Definition> = Definition extends readonly (infer Component)[]
  ? Component extends SlotComponent
    ? ReactElement<SlotProps<Component>>[]
    : never
  : Definition extends SlotComponent
    ? ReactElement<SlotProps<Definition>> | null
    : never;

type PreparedSlots<Definitions extends SlotDefinitions> = {
  [Key in keyof Definitions]: PreparedSlot<Definitions[Key]>;
};

type SlotEntries<Definitions extends SlotDefinitions> = {
  [Key in keyof Definitions]: [Key, Definitions[Key]];
}[keyof Definitions][];

function buildInitialSlots<Definitions extends SlotDefinitions>(
  slotEntries: SlotEntries<Definitions>,
): PreparedSlots<Definitions> {
  const preparedSlots = {} as PreparedSlots<Definitions>;

  for (const [key, definition] of slotEntries) {
    preparedSlots[key] = (
      Array.isArray(definition) ? [] : null
    ) as PreparedSlots<Definitions>[typeof key];
  }

  return preparedSlots;
}

function getSlotComponents(definition: SlotDefinition): readonly SlotComponent[] {
  return Array.isArray(definition) ? definition : [definition];
}

function resolveSlotEntry<Definitions extends SlotDefinitions>(
  slotEntries: SlotEntries<Definitions>,
  child: ReactElement,
): SlotEntries<Definitions>[number] | undefined {
  for (const slotEntry of slotEntries) {
    const [, definition] = slotEntry;

    for (const slotComponent of getSlotComponents(definition)) {
      if (child.type === slotComponent) {
        return slotEntry;
      }
    }
  }

  return undefined;
}

export function prepareComponentSlots<Definitions extends SlotDefinitions>(
  definitions: Definitions,
  options: PrepareComponentSlotsOptions = {},
): (children: ReactNode) => PreparedSlots<Definitions> {
  const slotEntries = Object.entries(definitions) as SlotEntries<Definitions>;
  const { strict = false } = options;

  return function usePreparedComponentSlots(children: ReactNode): PreparedSlots<Definitions> {
    return useMemo(() => {
      const preparedSlots = buildInitialSlots(slotEntries);

      for (const child of Children.toArray(children)) {
        if (!isValidElement(child)) {
          if (strict) {
            throw new Error("Unexpected non-element child passed to slot-based component.");
          }

          continue;
        }

        const slotEntry = resolveSlotEntry(slotEntries, child);

        if (slotEntry == null) {
          if (strict) {
            throw new Error("Unexpected child passed to slot-based component.");
          }

          continue;
        }

        const [key, definition] = slotEntry;

        if (Array.isArray(definition)) {
          const slotChildren = preparedSlots[key] as ReactElement[];
          slotChildren.push(child);
          continue;
        }

        preparedSlots[key] = child as PreparedSlots<Definitions>[typeof key];
      }

      return preparedSlots;
    }, [children]);
  };
}
