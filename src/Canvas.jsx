import React from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  useDraggable,
  DragOverlay,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";

// Dummy data for demonstration
const initialFields = [
  { id: "field-1", label: "Name" },
  { id: "field-2", label: "Email" },
  { id: "field-3", label: "Message" },
];

function DraggableField({ id, label }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-3 mb-2 rounded bg-blue-100 dark:bg-blue-900 shadow cursor-move select-none ${
        isDragging ? "opacity-50" : ""
      }`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition: "transform 200ms",
      }}
    >
      {label}
    </div>
  );
}

export default function Canvas() {
  const [fields, setFields] = React.useState(initialFields);
  const [activeId, setActiveId] = React.useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor)
  );

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = fields.findIndex((f) => f.id === active.id);
      const newIndex = fields.findIndex((f) => f.id === over?.id);
      setFields((fields) => arrayMove(fields, oldIndex, newIndex));
    }
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-2 sm:p-4 w-full max-w-full min-h-[300px]">
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {fields.map((field) => (
            <DraggableField key={field.id} id={field.id} label={field.label} />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeId ? (
            <div className="p-3 rounded bg-blue-200 dark:bg-blue-800 shadow">
              {fields.find((f) => f.id === activeId)?.label}
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}