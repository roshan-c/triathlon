"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  useDroppable
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { PriorityBadge } from "@/components/priority-badge";
import { useAppContext } from "@/components/app-context";
import { cvx, Priority } from "@/lib/convex";

function CardPreview({ card }: { card: any }) {
  return (
    <div className="panel w-[280px] p-3 text-left">
      <p className="line-clamp-2 text-sm font-semibold uppercase text-[var(--foreground)]">{card.title}</p>
      <div className="muted mt-2 flex items-center justify-between text-xs">
        <span>{card.storyPoints} pts</span>
        <PriorityBadge priority={card.priority as Priority} />
      </div>
    </div>
  );
}

function DraggableCard({ card, onSelect }: { card: any; onSelect: (cardId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card._id,
    data: {
      cardId: card._id,
      columnId: card.columnId
    }
  });

  return (
    <button
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 25 : 1
      }}
      className={`panel relative w-full p-3 text-left transition ${isDragging ? "opacity-30" : "opacity-100"}`}
      onClick={() => onSelect(card._id as string)}
      {...listeners}
      {...attributes}
      type="button"
    >
      <p className="line-clamp-2 text-sm font-semibold uppercase text-[var(--foreground)]">{card.title}</p>
      <div className="muted mt-2 flex items-center justify-between text-xs">
        <span>{card.storyPoints} pts</span>
        <PriorityBadge priority={card.priority as Priority} />
      </div>
    </button>
  );
}

function BoardColumn({ column, children }: { column: any; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: column._id,
    data: { columnId: column._id }
  });

  return (
    <section
      ref={setNodeRef}
      className={`panel flex h-[66vh] min-w-[82vw] flex-col p-3 sm:min-w-[320px] ${isOver ? "border-[var(--accent)]" : ""}`}
    >
      <header className="mb-3 flex items-center justify-between px-1">
        <h2 className="font-display text-base font-semibold uppercase text-[var(--foreground)]">{column.name}</h2>
        <span className="pill bg-[var(--background-alt)] text-[var(--muted-foreground)]">{column.cards.length}</span>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-auto pb-2">{children}</div>
    </section>
  );
}

export default function BoardPage() {
  const { externalId, project } = useAppContext();

  const board = useQuery(cvx.boards.getBoard, {
    projectId: project.projectId,
    externalId
  });

  const members = useQuery(cvx.projects.members, {
    projectId: project.projectId,
    externalId
  });

  const sprints = useQuery(cvx.sprints.list, {
    projectId: project.projectId,
    externalId
  });

  const createCard = useMutation(cvx.boards.createCard);
  const moveCard = useMutation(cvx.boards.moveCard);
  const updateCard = useMutation(cvx.boards.updateCard);
  const deleteCard = useMutation(cvx.boards.deleteCard);
  const attachCardToSprint = useMutation(cvx.boards.attachCardToSprint);

  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardDescription, setNewCardDescription] = useState("");
  const [newCardStoryPoints, setNewCardStoryPoints] = useState(1);
  const [newCardSprintId, setNewCardSprintId] = useState("");
  const [newCardAssigneeExternalId, setNewCardAssigneeExternalId] = useState("");

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activeDragCardId, setActiveDragCardId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCardId) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCardId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCardId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 6
      }
    })
  );

  const allCards = useMemo(
    () =>
      board?.columns.flatMap((column: any) =>
        column.cards.map((card: any) => ({ ...card, columnId: column._id }))
      ) ?? [],
    [board]
  );
  const selectedCard = allCards.find((card: any) => card._id === selectedCardId) ?? null;
  const activeDragCard = allCards.find((card: any) => card._id === activeDragCardId) ?? null;

  const activity = useQuery(
    cvx.boards.activity,
    selectedCard
      ? {
          projectId: project.projectId,
          externalId,
          cardId: selectedCard._id
        }
      : "skip"
  );

  const onDragStart = (event: DragStartEvent) => {
    const cardId = event.active.data.current?.cardId as string | undefined;
    setActiveDragCardId(cardId ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const toColumnId = event.over?.id as string | undefined;
    const fromColumnId = event.active.data.current?.columnId as string | undefined;
    const cardId = event.active.data.current?.cardId as string | undefined;

    setActiveDragCardId(null);

    if (!toColumnId || !fromColumnId || !cardId || toColumnId === fromColumnId) {
      return;
    }

    await moveCard({
      projectId: project.projectId,
      externalId,
      cardId,
      toColumnId
    });
  };

  const submitNewCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!board || !newCardTitle.trim()) {
      return;
    }

    await createCard({
      projectId: project.projectId,
      externalId,
      columnId: board.columns[0]._id,
      title: newCardTitle,
      description: newCardDescription,
      storyPoints: Number.isFinite(newCardStoryPoints) ? Math.max(0, newCardStoryPoints) : 0,
      sprintId: newCardSprintId || undefined,
      assigneeExternalId: newCardAssigneeExternalId || undefined,
      priority: "medium",
      labels: []
    });

    setNewCardTitle("");
    setNewCardDescription("");
    setNewCardStoryPoints(1);
    setNewCardSprintId("");
    setNewCardAssigneeExternalId("");
  };

  const deleteSelectedCard = async () => {
    if (!selectedCard) {
      return;
    }
    const confirmed = window.confirm("Delete this task permanently?");
    if (!confirmed) {
      return;
    }

    await deleteCard({
      projectId: project.projectId,
      externalId,
      cardId: selectedCard._id
    });
    setSelectedCardId(null);
  };

  if (!board) {
    return <div className="panel muted p-6 text-sm">Loading board...</div>;
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <form onSubmit={submitNewCard} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            value={newCardTitle}
            onChange={(event) => setNewCardTitle(event.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm sm:col-span-2"
            placeholder="Task title"
            required
          />
          <textarea
            value={newCardDescription}
            onChange={(event) => setNewCardDescription(event.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm sm:col-span-2 lg:col-span-1"
            placeholder="Description"
            rows={1}
          />
          <input
            value={newCardStoryPoints}
            onChange={(event) => setNewCardStoryPoints(Number(event.target.value || 0))}
            type="number"
            min={0}
            className="w-full rounded-md px-3 py-2 text-sm"
            placeholder="Story points"
          />
          <select
            value={newCardAssigneeExternalId}
            onChange={(event) => setNewCardAssigneeExternalId(event.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {(members ?? []).map((member: any) => (
              <option key={member.userId} value={member.externalId}>
                {member.name}
              </option>
            ))}
          </select>
          <select
            value={newCardSprintId}
            onChange={(event) => setNewCardSprintId(event.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm"
          >
            <option value="">No sprint</option>
            {(sprints ?? []).map((sprint: any) => (
              <option key={sprint._id} value={sprint._id}>
                {sprint.name}
              </option>
            ))}
          </select>
          <button className="btn-accent rounded-md px-4 py-2 text-sm font-semibold uppercase lg:col-span-1" type="submit">
            Add Task
          </button>
        </form>
      </section>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDragCardId(null)}
      >
        <section className="flex gap-4 overflow-auto pb-2">
          {board.columns.map((column: any) => (
            <BoardColumn key={column._id} column={column}>
              {column.cards.map((card: any) => (
                <DraggableCard key={card._id} card={{ ...card, columnId: column._id }} onSelect={setSelectedCardId} />
              ))}
            </BoardColumn>
          ))}
        </section>

        <DragOverlay>{activeDragCard ? <CardPreview card={activeDragCard} /> : null}</DragOverlay>
      </DndContext>

      {selectedCard ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3"
          onClick={() => setSelectedCardId(null)}
        >
          <section
            className="panel max-h-[92vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold uppercase">Card Detail</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border-2 border-[var(--danger-text)] bg-[var(--danger-soft)] px-3 py-1 text-xs font-semibold uppercase text-[var(--danger-text)]"
                  onClick={deleteSelectedCard}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn-ghost rounded-md px-3 py-1 text-xs uppercase"
                  onClick={() => setSelectedCardId(null)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="muted mb-1 block">Title</span>
                <input
                  defaultValue={selectedCard.title}
                  className="w-full rounded-md px-3 py-2"
                  onBlur={(event) =>
                    void updateCard({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      title: event.target.value
                    })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="muted mb-1 block">Story points</span>
                <input
                  defaultValue={selectedCard.storyPoints}
                  type="number"
                  min={0}
                  className="w-full rounded-md px-3 py-2"
                  onBlur={(event) =>
                    void updateCard({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      storyPoints: Number(event.target.value || 0)
                    })
                  }
                />
              </label>

              <label className="block text-sm md:col-span-2">
                <span className="muted mb-1 block">Description</span>
                <textarea
                  defaultValue={selectedCard.description}
                  className="min-h-24 w-full rounded-md px-3 py-2"
                  onBlur={(event) =>
                    void updateCard({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      description: event.target.value
                    })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="muted mb-1 block">Priority</span>
                <select
                  value={selectedCard.priority}
                  className="w-full rounded-md px-3 py-2"
                  onChange={(event) =>
                    void updateCard({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      priority: event.target.value as Priority
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="muted mb-1 block">Assignee</span>
                <select
                  value={selectedCard.assigneeId ?? ""}
                  className="w-full rounded-md px-3 py-2"
                  onChange={(event) => {
                    const selectedUserId = event.target.value;
                    const selectedMember = (members ?? []).find((member: any) => member.userId === selectedUserId);
                    void updateCard({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      assigneeExternalId: selectedMember?.externalId ?? ""
                    });
                  }}
                >
                  <option value="">Unassigned</option>
                  {(members ?? []).map((member: any) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="muted mb-1 block">Sprint</span>
                <select
                  value={selectedCard.sprintId ?? ""}
                  className="w-full rounded-md px-3 py-2"
                  onChange={(event) =>
                    void attachCardToSprint({
                      projectId: project.projectId,
                      externalId,
                      cardId: selectedCard._id,
                      sprintId: event.target.value || undefined
                    })
                  }
                >
                  <option value="">No sprint</option>
                  {(sprints ?? []).map((sprint: any) => (
                    <option key={sprint._id} value={sprint._id}>
                      {sprint.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="text-sm">
                <p className="muted mb-1">Recent activity</p>
                <div className="max-h-40 space-y-1 overflow-auto rounded-md border-2 border-[var(--border)] bg-[var(--card)] p-2">
                  {(activity ?? []).length === 0 ? (
                    <p className="muted text-xs">No movement yet.</p>
                  ) : (
                    (activity ?? []).map((item: any) => (
                      <p key={item._id} className="muted text-xs">
                        Moved at {new Date(item.movedAt).toLocaleString()}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
