"use client";

import { useState, useTransition } from "react";

type Task = { id: string; title: string; status: "TODO" | "DONE" };

export default function Kanban({
  clientId,
  initialTasks,
  onToggle,
  onCreate,
}: {
  clientId: string;
  initialTasks: Task[];
  onToggle: (taskId: string, status: "TODO" | "DONE") => Promise<void>;
  onCreate: (clientId: string, title: string) => Promise<Task>;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [newTitle, setNewTitle] = useState("");
  const [, startTransition] = useTransition();

  const todo = tasks.filter((t) => t.status === "TODO");
  const done = tasks.filter((t) => t.status === "DONE");

  function toggle(task: Task) {
    const nextStatus = task.status === "TODO" ? "DONE" : "TODO";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    startTransition(async () => {
      await onToggle(task.id, nextStatus);
    });
  }

  function addTask() {
    if (!newTitle.trim()) return;
    const title = newTitle.trim();
    setNewTitle("");
    startTransition(async () => {
      const created = await onCreate(clientId, title);
      setTasks((prev) => [...prev, created]);
    });
  }

  return (
    <div className="custom-card p-lg h-full">
      <div className="flex justify-between items-center mb-lg">
        <h4 className="font-headline-sm text-primary">Campaign tasks</h4>
        <div className="flex gap-xs">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            className="text-body-sm border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 outline-none h-9 px-3 w-48"
            placeholder="Quick add task..."
            type="text"
          />
          <button onClick={addTask} className="h-9 w-9 flex items-center justify-center bg-primary text-white rounded-lg hover:opacity-90">
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-gutter">
        <Column title="To do" count={todo.length} colorClass="text-primary" icon="assignment">
          {todo.map((t) => <TaskCard key={t.id} task={t} onToggle={() => toggle(t)} />)}
        </Column>
        <Column title="Done" count={done.length} colorClass="text-secondary" icon="check_circle">
          {done.map((t) => <TaskCard key={t.id} task={t} onToggle={() => toggle(t)} />)}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, count, colorClass, icon, children }: { title: string; count: number; colorClass: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col bg-surface-container rounded-xl p-md min-h-[300px]">
      <div className={`flex items-center gap-xs mb-md font-bold ${colorClass}`}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
        <h5 className="text-label-md">{title}</h5>
        <span className="ml-auto bg-white/50 px-2 py-0.5 rounded text-[10px]">{count}</span>
      </div>
      <div className="space-y-sm">{children}</div>
    </div>
  );
}

function TaskCard({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const isDone = task.status === "DONE";
  return (
    <div
      onClick={onToggle}
      className={`bg-white p-md rounded-lg border border-outline-variant hover:border-primary/40 transition-colors cursor-pointer ${isDone ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-md">
        <div className={`mt-1 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isDone ? "bg-secondary border-secondary" : "border-outline-variant"}`}>
          {isDone && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={3}>
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <p className={`text-body-sm font-medium ${isDone ? "line-through" : ""}`}>{task.title}</p>
      </div>
    </div>
  );
}
