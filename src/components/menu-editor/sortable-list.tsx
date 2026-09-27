"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/** Vertical drag-and-drop list. Mouse: drag the handle. Touch: press and hold the handle. Keyboard: focus the handle, Space, arrows, Space. */
export function SortableList<T extends { id: number }>({
  items,
  disabled,
  onReorder,
  children,
}: {
  items: T[];
  disabled?: boolean;
  onReorder: (next: T[]) => void;
  children: (item: T, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy} disabled={disabled}>
        {items.map((item) => (
          <SortableRow key={item.id} id={item.id} disabled={disabled}>
            {(handle) => children(item, handle)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, disabled, children }: { id: number; disabled?: boolean; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Mover (arrastrar para ordenar)"
      title="Arrastrar para ordenar"
      disabled={disabled}
      className="mt-0.5 cursor-grab touch-none select-none px-1 text-xl leading-none text-ink-soft hover:text-red active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
    >
      ⠿
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 bg-paper shadow-lg" : undefined}
    >
      {children(handle)}
    </li>
  );
}
