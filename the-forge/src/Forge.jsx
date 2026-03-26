import { useState, useEffect, useRef, useCallback } from "react";

// ─── Supabase Config ───
const SUPABASE_URL = "https://uhfuskvhwuxphwslkeiw.supabase.co";
const SUPABASE_KEY = "sb_publishable_dTdyyGORoiDZlN_w6aWJ7Q_cKvrfwEi";

// ─── Lightweight Supabase REST Client ───
const supabase = {
  auth: {
    _session: null,
    _listeners: [],

    onAuthStateChange(callback) {
      this._listeners.push(callback);
      this._restoreSession().then((session) => {
        if (session) callback("SIGNED_IN", session);
        else callback("SIGNED_OUT", null);
      });
      return { data: { subscription: { unsubscribe: () => {} } } };
    },

    async _restoreSession() {
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const expiresIn = params.get("expires_in");
        if (accessToken) {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_KEY },
          });
          if (userRes.ok) {
            const user = await userRes.json();
            const session = { access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + parseInt(expiresIn || "3600"), user };
            this._session = session;
            try { localStorage.setItem("forge-session", JSON.stringify(session)); } catch (e) {}
            window.history.replaceState(null, "", window.location.pathname);
            return session;
          }
        }
      }
      try {
        const stored = localStorage.getItem("forge-session");
        if (stored) {
          const session = JSON.parse(stored);
          if (session.expires_at && session.expires_at > Date.now() / 1000 + 60) {
            this._session = session;
            return session;
          } else if (session.refresh_token) {
            return await this._refreshSession(session.refresh_token);
          }
          localStorage.removeItem("forge-session");
        }
      } catch (e) {}
      return null;
    },

    async _refreshSession(refreshToken) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (res.ok) {
          const data = await res.json();
          const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600), user: data.user };
          this._session = session;
          try { localStorage.setItem("forge-session", JSON.stringify(session)); } catch (e) {}
          return session;
        }
      } catch (e) {}
      return null;
    },

    // Background refresh — call this to start a timer that refreshes the token before it expires
    startAutoRefresh() {
      this.stopAutoRefresh();
      this._refreshInterval = setInterval(async () => {
        if (this._session?.refresh_token) {
          const timeLeft = (this._session.expires_at || 0) - Date.now() / 1000;
          // Refresh if less than 5 minutes remaining
          if (timeLeft < 300) {
            await this._refreshSession(this._session.refresh_token);
          }
        }
      }, 60000); // Check every minute
    },

    stopAutoRefresh() {
      if (this._refreshInterval) { clearInterval(this._refreshInterval); this._refreshInterval = null; }
    },

    async signInWithOAuth({ provider }) {
      const redirectTo = window.location.origin + window.location.pathname;
      window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;
    },

    async signOut() {
      if (this._session?.access_token) {
        try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { Authorization: `Bearer ${this._session.access_token}`, apikey: SUPABASE_KEY } }); } catch (e) {}
      }
      this._session = null;
      this.stopAutoRefresh();
      try { localStorage.removeItem("forge-session"); } catch (e) {}
      this._listeners.forEach((cb) => cb("SIGNED_OUT", null));
    },
  },

  from(table) {
    const token = this.auth._session?.access_token;
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };

    return {
      async select() {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.asc`, { headers });
        if (!res.ok) throw new Error(`Select failed: ${res.status}`);
        return { data: await res.json(), error: null };
      },
      async upsert(rows) {
        const h = { ...headers, Prefer: "return=representation,resolution=merge-duplicates" };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: h, body: JSON.stringify(Array.isArray(rows) ? rows : [rows]) });
        if (!res.ok) throw new Error(`Upsert failed: ${res.status} ${await res.text()}`);
        return { data: await res.json(), error: null };
      },
      delete() {
        let filters = [];
        return {
          eq(col, val) { filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; },
          async execute() {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filters.join("&")}`, { method: "DELETE", headers });
            if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
            return { error: null };
          },
        };
      },
    };
  },
};

// ─── Constants ───
const STAGES = [
  { id: "spark", label: "Spark", emoji: "💡", description: "Raw ideas & brain nuggets", color: "#f59e0b" },
  { id: "shaping", label: "Shaping", emoji: "🔬", description: "Fleshing it out", color: "#8b5cf6" },
  { id: "planned", label: "Planned", emoji: "📐", description: "Ready to build", color: "#3b82f6" },
  { id: "building", label: "Building", emoji: "🔨", description: "Actively working", color: "#10b981" },
  { id: "paused", label: "Paused", emoji: "⏸️", description: "On the shelf", color: "#6b7280" },
  { id: "done", label: "Done", emoji: "✅", description: "Shipped it", color: "#06b6d4" },
];

const generateId = () => Math.random().toString(36).substr(2, 9);
const getToday = () => new Date().toISOString().slice(0, 10); // "2026-03-25"

// Get all tasks from a project (loose + milestone tasks)
function getAllTasks(project) {
  const loose = (project.tasks || []).map((t) => ({ ...t, milestoneId: null, milestoneName: null }));
  const fromMilestones = (project.milestones || []).flatMap((m) => (m.tasks || []).map((t) => ({ ...t, milestoneId: m.id, milestoneName: m.name })));
  return [...loose, ...fromMilestones];
}

// Get the flag status of a task: "today", "stale", or null
function getFlagStatus(task) {
  if (!task.flaggedFor) return null;
  if (task.done) return null;
  const today = getToday();
  if (task.flaggedFor === today) return "today";
  if (task.flaggedFor < today) return "stale";
  return "today"; // future flag — treat as today
}

// Count tasks for Today view
function getTodayCount(projects) {
  let count = 0;
  projects.forEach((p) => {
    getAllTasks(p).forEach((t) => {
      if (!t.done && t.flaggedFor) count++;
    });
  });
  return count;
}

function dbToProject(row) {
  const raw = typeof row.tasks === "string" ? JSON.parse(row.tasks) : (row.tasks || []);
  // Backward compatibility: old format is flat array of tasks. New format is { tasks: [], milestones: [] }
  let tasks, milestones;
  if (Array.isArray(raw)) {
    tasks = raw;
    milestones = [];
  } else {
    tasks = raw.tasks || [];
    milestones = raw.milestones || [];
  }
  return { id: row.id, name: row.name, description: row.description || "", stage: row.stage, notes: row.notes || "", tasks, milestones, createdAt: row.created_at, lastTouchedAt: row.last_touched_at };
}

function projectToDb(p) {
  return { id: p.id, name: p.name, description: p.description || "", stage: p.stage, notes: p.notes || "", tasks: JSON.stringify({ tasks: p.tasks || [], milestones: p.milestones || [] }), created_at: p.createdAt, last_touched_at: p.lastTouchedAt };
}

// ─── Login Screen ───
function LoginScreen() {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ background: "#111114", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", padding: "40px" }}>
        <div style={{ fontSize: "56px", marginBottom: "16px" }}>🔥</div>
        <h1 style={{ fontSize: "36px", fontWeight: "700", fontFamily: "'Space Grotesk', sans-serif", color: "#f59e0b", margin: "0 0 8px", letterSpacing: "-1px" }}>THE FORGE</h1>
        <p style={{ color: "#555", fontSize: "14px", letterSpacing: "3px", textTransform: "uppercase", margin: "0 0 40px" }}>idea → execution</p>
        <p style={{ color: "#888", fontSize: "15px", maxWidth: "360px", margin: "0 auto 32px", lineHeight: "1.6" }}>Your personal command center for turning ideas into reality.</p>
        <button onClick={() => { setLoading(true); supabase.auth.signInWithOAuth({ provider: "google" }); }} disabled={loading}
          style={{ display: "inline-flex", alignItems: "center", gap: "12px", background: "#fff", border: "none", borderRadius: "10px", padding: "14px 32px", fontSize: "15px", fontWeight: "600", color: "#333", cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          {loading ? "Redirecting…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}

// ─── Focus Stats ───
function FocusStats({ projects }) {
  const active = projects.filter((p) => p.stage === "building");
  const totalTasks = projects.reduce((s, p) => s + getAllTasks(p).length, 0);
  const doneTasks = projects.reduce((s, p) => s + getAllTasks(p).filter((t) => t.done).length, 0);
  const rate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const stale = projects.filter((p) => p.stage !== "done" && p.stage !== "paused" && (Date.now() - p.lastTouchedAt) / 86400000 > 7);
  const weekDone = projects.reduce((s, p) => s + getAllTasks(p).filter((t) => t.done && t.completedAt && Date.now() - t.completedAt < 7 * 86400000).length, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
      {[
        { label: "Active Projects", value: active.length, sub: active.length > 3 ? "⚠️ Consider focusing" : "Looking good", accent: active.length > 3 ? "#f59e0b" : "#10b981" },
        { label: "Task Completion", value: `${rate}%`, sub: `${doneTasks}/${totalTasks} tasks`, accent: rate > 60 ? "#10b981" : rate > 30 ? "#f59e0b" : "#ef4444" },
        { label: "Done This Week", value: weekDone, sub: weekDone > 0 ? "Keep it up!" : "Let's get moving", accent: weekDone > 0 ? "#10b981" : "#6b7280" },
        { label: "Going Stale", value: stale.length, sub: stale.length > 0 ? stale[0]?.name?.slice(0, 20) : "All fresh", accent: stale.length > 0 ? "#ef4444" : "#10b981" },
      ].map((s) => (
        <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "12px", padding: "16px", borderLeft: `3px solid ${s.accent}` }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#888", marginBottom: "6px", fontFamily: "'JetBrains Mono', monospace" }}>{s.label}</div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "#f0f0f0", fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
          <div style={{ fontSize: "12px", color: s.accent, marginTop: "4px" }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Project Card ───
function ProjectCard({ project, onSelect, isDragging }) {
  const allT = getAllTasks(project);
  const done = allT.filter((t) => t.done).length;
  const total = allT.length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const days = Math.floor((Date.now() - project.lastTouchedAt) / 86400000);
  const stg = STAGES.find((s) => s.id === project.stage);

  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", project.id)} onClick={() => onSelect(project)}
      style={{ background: isDragging ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px", marginBottom: "8px", cursor: "grab", transition: "all 0.2s ease", opacity: isDragging ? 0.5 : 1 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = stg?.color || "#555"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}>
      <div style={{ fontWeight: "600", fontSize: "14px", color: "#e8e8e8", marginBottom: "6px", lineHeight: "1.3" }}>{project.name}</div>
      {project.description && <div style={{ fontSize: "12px", color: "#777", marginBottom: "8px", lineHeight: "1.4" }}>{project.description.length > 80 ? project.description.slice(0, 80) + "…" : project.description}</div>}
      {total > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#666", marginBottom: "4px" }}><span>{done}/{total} tasks</span><span>{Math.round(pct)}%</span></div>
          <div style={{ height: "3px", background: "rgba(255,255,255,0.08)", borderRadius: "2px", overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: stg?.color || "#888", borderRadius: "2px", transition: "width 0.3s ease" }} /></div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: days > 7 ? "#ef4444" : days > 3 ? "#f59e0b" : "#666" }}>{days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`}</span>
        {total > 0 && done === total && <span style={{ fontSize: "11px", color: "#10b981" }}>Complete</span>}
      </div>
    </div>
  );
}

// ─── Pipeline Column ───
function PipelineColumn({ stage, projects, onSelect, onDrop, draggingId }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e.dataTransfer.getData("text/plain"), stage.id); }}
      style={{ minWidth: "260px", maxWidth: "300px", flex: "1 0 260px", background: dragOver ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)", borderRadius: "14px", padding: "16px", border: dragOver ? `1px solid ${stage.color}44` : "1px solid transparent", transition: "all 0.2s ease", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <span style={{ fontSize: "18px" }}>{stage.emoji}</span>
        <div>
          <div style={{ fontWeight: "700", fontSize: "13px", color: stage.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>{stage.label}</div>
          <div style={{ fontSize: "11px", color: "#555" }}>{stage.description}</div>
        </div>
        <span style={{ marginLeft: "auto", background: `${stage.color}22`, color: stage.color, fontSize: "12px", fontWeight: "700", padding: "2px 8px", borderRadius: "10px" }}>{projects.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: "100px" }}>
        {projects.map((p) => <ProjectCard key={p.id} project={p} onSelect={onSelect} isDragging={draggingId === p.id} />)}
        {projects.length === 0 && <div style={{ textAlign: "center", padding: "24px 12px", color: "#444", fontSize: "13px", fontStyle: "italic" }}>Drag projects here</div>}
      </div>
    </div>
  );
}

// ─── Project Detail Modal ───
function ProjectDetail({ project, onClose, onUpdate, onDelete }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [notes, setNotes] = useState(project.notes || "");
  const [newTask, setNewTask] = useState("");
  const [newMilestoneName, setNewMilestoneName] = useState("");
  const [showNewMilestone, setShowNewMilestone] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [editingMilestoneName, setEditingMilestoneName] = useState("");
  const [collapsedMilestones, setCollapsedMilestones] = useState({});
  const [milestoneNewTask, setMilestoneNewTask] = useState({});
  const stg = STAGES.find((s) => s.id === project.stage);
  const timer = useRef(null);

  const debounced = (updates) => { clearTimeout(timer.current); timer.current = setTimeout(() => onUpdate({ ...project, ...updates, lastTouchedAt: Date.now() }), 600); };

  // Loose task operations
  const addTask = () => { if (!newTask.trim()) return; const t = { id: generateId(), text: newTask.trim(), done: false, createdAt: Date.now() }; onUpdate({ ...project, tasks: [...project.tasks, t], lastTouchedAt: Date.now() }); setNewTask(""); };
  const toggleTask = (tid) => { const u = project.tasks.map((t) => t.id === tid ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : null } : t); onUpdate({ ...project, tasks: u, lastTouchedAt: Date.now() }); };
  const delTask = (tid) => onUpdate({ ...project, tasks: project.tasks.filter((t) => t.id !== tid), lastTouchedAt: Date.now() });
  const startEditTask = (task) => { setEditingTaskId(task.id); setEditingTaskText(task.text); };
  const saveEditTask = () => { if (editingTaskText.trim()) { const u = project.tasks.map((t) => t.id === editingTaskId ? { ...t, text: editingTaskText.trim() } : t); onUpdate({ ...project, tasks: u, lastTouchedAt: Date.now() }); } setEditingTaskId(null); setEditingTaskText(""); };

  // Milestone operations
  const addMilestone = () => { if (!newMilestoneName.trim()) return; const m = { id: generateId(), name: newMilestoneName.trim(), tasks: [], createdAt: Date.now() }; onUpdate({ ...project, milestones: [...(project.milestones || []), m], lastTouchedAt: Date.now() }); setNewMilestoneName(""); setShowNewMilestone(false); };
  const delMilestone = (mid) => onUpdate({ ...project, milestones: (project.milestones || []).filter((m) => m.id !== mid), lastTouchedAt: Date.now() });
  const startEditMilestone = (m) => { setEditingMilestoneId(m.id); setEditingMilestoneName(m.name); };
  const saveEditMilestone = () => { if (editingMilestoneName.trim()) { const u = (project.milestones || []).map((m) => m.id === editingMilestoneId ? { ...m, name: editingMilestoneName.trim() } : m); onUpdate({ ...project, milestones: u, lastTouchedAt: Date.now() }); } setEditingMilestoneId(null); setEditingMilestoneName(""); };
  const toggleCollapse = (mid) => setCollapsedMilestones((prev) => ({ ...prev, [mid]: !prev[mid] }));

  // Milestone task operations
  const addMilestoneTask = (mid) => { const text = (milestoneNewTask[mid] || "").trim(); if (!text) return; const t = { id: generateId(), text, done: false, createdAt: Date.now() }; const u = (project.milestones || []).map((m) => m.id === mid ? { ...m, tasks: [...m.tasks, t] } : m); onUpdate({ ...project, milestones: u, lastTouchedAt: Date.now() }); setMilestoneNewTask((prev) => ({ ...prev, [mid]: "" })); };
  const toggleMilestoneTask = (mid, tid) => { const u = (project.milestones || []).map((m) => m.id === mid ? { ...m, tasks: m.tasks.map((t) => t.id === tid ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : null } : t) } : m); onUpdate({ ...project, milestones: u, lastTouchedAt: Date.now() }); };
  const delMilestoneTask = (mid, tid) => { const u = (project.milestones || []).map((m) => m.id === mid ? { ...m, tasks: m.tasks.filter((t) => t.id !== tid) } : m); onUpdate({ ...project, milestones: u, lastTouchedAt: Date.now() }); };
  const startEditMilestoneTask = (task) => { setEditingTaskId(task.id); setEditingTaskText(task.text); };
  const saveEditMilestoneTask = (mid) => { if (editingTaskText.trim()) { const u = (project.milestones || []).map((m) => m.id === mid ? { ...m, tasks: m.tasks.map((t) => t.id === editingTaskId ? { ...t, text: editingTaskText.trim() } : t) } : m); onUpdate({ ...project, milestones: u, lastTouchedAt: Date.now() }); } setEditingTaskId(null); setEditingTaskText(""); };

  const saveName = () => { if (name.trim()) onUpdate({ ...project, name: name.trim(), lastTouchedAt: Date.now() }); setEditingName(false); };

  const allT = getAllTasks(project);
  const doneT = allT.filter((t) => t.done).length;
  const totalT = allT.length;

  const renderTask = (task, { onToggle, onDel, onStartEdit, onSaveEdit, milestoneId }) => (
    <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <button onClick={onToggle}
        style={{ width: "20px", height: "20px", minWidth: "20px", borderRadius: "6px", border: task.done ? "none" : "2px solid rgba(255,255,255,0.2)", background: task.done ? stg.color : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "12px", marginTop: "1px" }}>
        {task.done && "✓"}
      </button>
      {editingTaskId === task.id ? (
        <input autoFocus value={editingTaskText} onChange={(e) => setEditingTaskText(e.target.value)}
          onBlur={() => milestoneId ? saveEditMilestoneTask(milestoneId) : saveEditTask()}
          onKeyDown={(e) => { if (e.key === "Enter") { milestoneId ? saveEditMilestoneTask(milestoneId) : saveEditTask(); } if (e.key === "Escape") { setEditingTaskId(null); setEditingTaskText(""); } }}
          style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#ccc", fontSize: "14px", padding: "4px 8px", outline: "none", fontFamily: "inherit" }} />
      ) : (
        <span onClick={() => onStartEdit(task)} style={{ flex: 1, fontSize: "14px", color: task.done ? "#555" : "#ccc", textDecoration: task.done ? "line-through" : "none", lineHeight: "1.4", cursor: "pointer", borderRadius: "4px", padding: "2px 4px", margin: "-2px -4px" }}
          onMouseEnter={(e) => { if (!task.done) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{task.text}</span>
      )}
      <button onClick={onDel} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "16px", padding: "0 4px", lineHeight: 1 }}
        onMouseEnter={(e) => (e.target.style.color = "#ef4444")} onMouseLeave={(e) => (e.target.style.color = "#444")}>×</button>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "5vh", zIndex: 1000, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a1e", borderRadius: "16px", width: "100%", maxWidth: "640px", margin: "0 16px 40px", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
        <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
            {editingName ? (
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", color: "#f0f0f0", fontSize: "20px", fontWeight: "700", padding: "6px 10px", flex: 1, marginRight: "12px", outline: "none" }} />
            ) : (
              <h2 onClick={() => setEditingName(true)} style={{ fontSize: "20px", fontWeight: "700", color: "#f0f0f0", margin: 0, cursor: "pointer", flex: 1 }}>{project.name}</h2>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: "24px", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ background: `${stg.color}22`, color: stg.color, fontSize: "12px", fontWeight: "600", padding: "4px 12px", borderRadius: "20px" }}>{stg.emoji} {stg.label}</span>
            {totalT > 0 && <span style={{ fontSize: "12px", color: "#777" }}>{doneT}/{totalT} tasks done ({Math.round((doneT / totalT) * 100)}%)</span>}
          </div>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "6px" }}>Description</label>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); debounced({ description: e.target.value }); }} placeholder="What is this project about?" rows={2}
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "14px", padding: "10px 12px", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          {/* ── Loose Tasks ── */}
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "10px" }}>Tasks & Steps</label>
            {project.tasks.map((task) => renderTask(task, { onToggle: () => toggleTask(task.id), onDel: () => delTask(task.id), onStartEdit: startEditTask, onSaveEdit: saveEditTask, milestoneId: null }))}
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="Add a task…"
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "14px", padding: "10px 12px", outline: "none" }} />
              <button onClick={addTask} style={{ background: stg.color, border: "none", borderRadius: "8px", color: "#fff", padding: "10px 16px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>Add</button>
            </div>
          </div>

          {/* ── Milestones ── */}
          {(project.milestones || []).map((milestone) => {
            const mDone = milestone.tasks.filter((t) => t.done).length;
            const mTotal = milestone.tasks.length;
            const isCollapsed = collapsedMilestones[milestone.id];
            return (
              <div key={milestone.id} style={{ marginBottom: "16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: isCollapsed ? 0 : "8px" }}>
                  <button onClick={() => toggleCollapse(milestone.id)}
                    style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "12px", padding: "2px 4px", transition: "transform 0.15s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</button>
                  {editingMilestoneId === milestone.id ? (
                    <input autoFocus value={editingMilestoneName} onChange={(e) => setEditingMilestoneName(e.target.value)} onBlur={saveEditMilestone} onKeyDown={(e) => { if (e.key === "Enter") saveEditMilestone(); if (e.key === "Escape") { setEditingMilestoneId(null); setEditingMilestoneName(""); } }}
                      style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#e0e0e0", fontSize: "14px", fontWeight: "600", padding: "4px 8px", outline: "none" }} />
                  ) : (
                    <span onClick={() => startEditMilestone(milestone)} style={{ flex: 1, fontWeight: "600", fontSize: "14px", color: "#e0e0e0", cursor: "pointer", borderRadius: "4px", padding: "2px 4px", margin: "-2px -4px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{milestone.name}</span>
                  )}
                  {mTotal > 0 && <span style={{ fontSize: "11px", color: mDone === mTotal && mTotal > 0 ? "#10b981" : "#777", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "8px" }}>{mDone}/{mTotal}</span>}
                  <button onClick={() => { if (confirm(`Delete milestone "${milestone.name}" and all its tasks?`)) delMilestone(milestone.id); }}
                    style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "14px", padding: "0 4px" }}
                    onMouseEnter={(e) => (e.target.style.color = "#ef4444")} onMouseLeave={(e) => (e.target.style.color = "#444")}>×</button>
                </div>
                {!isCollapsed && (
                  <div style={{ paddingLeft: "24px" }}>
                    {milestone.tasks.map((task) => renderTask(task, { onToggle: () => toggleMilestoneTask(milestone.id, task.id), onDel: () => delMilestoneTask(milestone.id, task.id), onStartEdit: startEditMilestoneTask, onSaveEdit: () => saveEditMilestoneTask(milestone.id), milestoneId: milestone.id }))}
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <input value={milestoneNewTask[milestone.id] || ""} onChange={(e) => setMilestoneNewTask((prev) => ({ ...prev, [milestone.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addMilestoneTask(milestone.id)} placeholder="Add task to this milestone…"
                        style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "13px", padding: "8px 10px", outline: "none" }} />
                      <button onClick={() => addMilestoneTask(milestone.id)} style={{ background: `${stg.color}33`, border: `1px solid ${stg.color}55`, borderRadius: "8px", color: stg.color, padding: "8px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Add Milestone Button ── */}
          {showNewMilestone ? (
            <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
              <input autoFocus value={newMilestoneName} onChange={(e) => setNewMilestoneName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMilestone(); if (e.key === "Escape") { setShowNewMilestone(false); setNewMilestoneName(""); } }} placeholder="Milestone name (e.g. Launch Shopify Site)"
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "14px", padding: "10px 12px", outline: "none" }} />
              <button onClick={addMilestone} style={{ background: stg.color, border: "none", borderRadius: "8px", color: "#fff", padding: "10px 16px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>Add</button>
              <button onClick={() => { setShowNewMilestone(false); setNewMilestoneName(""); }} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "8px", color: "#888", padding: "10px 12px", cursor: "pointer", fontSize: "13px" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowNewMilestone(true)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: "8px", color: "#888", padding: "10px 16px", cursor: "pointer", fontSize: "13px", width: "100%", marginBottom: "20px", transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#bbb"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#888"; }}>
              + Add Milestone
            </button>
          )}

          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "6px" }}>Notes</label>
            <textarea value={notes} onChange={(e) => { setNotes(e.target.value); debounced({ notes: e.target.value }); }} placeholder="Thoughts, links, context…" rows={3}
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "14px", padding: "10px 12px", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "8px" }}>Move to Stage</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {STAGES.map((s) => (
                <button key={s.id} onClick={() => onUpdate({ ...project, stage: s.id, lastTouchedAt: Date.now() })}
                  style={{ background: project.stage === s.id ? `${s.color}33` : "rgba(255,255,255,0.04)", border: project.stage === s.id ? `1px solid ${s.color}` : "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: project.stage === s.id ? s.color : "#888", fontSize: "12px", padding: "6px 12px", cursor: "pointer", fontWeight: project.stage === s.id ? "600" : "400" }}>
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "16px", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => { if (confirm("Delete this project? This can't be undone.")) { onDelete(project.id); onClose(); } }}
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#ef4444", fontSize: "13px", padding: "8px 16px", cursor: "pointer" }}>
              Delete Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Project Form ───
function NewProjectForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState("spark");
  const [desc, setDesc] = useState("");
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [milestones, setMilestones] = useState([]);
  const [newMilestoneName, setNewMilestoneName] = useState("");
  const [showNewMilestone, setShowNewMilestone] = useState(false);
  const [milestoneNewTask, setMilestoneNewTask] = useState({});
  const stg = STAGES.find((s) => s.id === stage);

  const addTask = () => { if (!newTask.trim()) return; setTasks((prev) => [...prev, { id: generateId(), text: newTask.trim(), done: false, createdAt: Date.now() }]); setNewTask(""); };
  const removeTask = (tid) => setTasks((prev) => prev.filter((t) => t.id !== tid));
  const addMilestone = () => { if (!newMilestoneName.trim()) return; setMilestones((prev) => [...prev, { id: generateId(), name: newMilestoneName.trim(), tasks: [], createdAt: Date.now() }]); setNewMilestoneName(""); setShowNewMilestone(false); };
  const removeMilestone = (mid) => setMilestones((prev) => prev.filter((m) => m.id !== mid));
  const addMilestoneTask = (mid) => { const text = (milestoneNewTask[mid] || "").trim(); if (!text) return; const t = { id: generateId(), text, done: false, createdAt: Date.now() }; setMilestones((prev) => prev.map((m) => m.id === mid ? { ...m, tasks: [...m.tasks, t] } : m)); setMilestoneNewTask((prev) => ({ ...prev, [mid]: "" })); };
  const removeMilestoneTask = (mid, tid) => setMilestones((prev) => prev.map((m) => m.id === mid ? { ...m, tasks: m.tasks.filter((t) => t.id !== tid) } : m));
  const create = () => { if (name.trim()) onAdd({ id: generateId(), name: name.trim(), stage, description: desc, tasks, milestones, notes: "", createdAt: Date.now(), lastTouchedAt: Date.now() }); };

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", alignItems: "flex-start", zIndex: 1000, overflowY: "auto", padding: "5vh 0" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a1e", borderRadius: "16px", padding: "28px", width: "100%", maxWidth: "460px", margin: "0 16px 40px", border: "1px solid rgba(255,255,255,0.1)" }}>
        <h3 style={{ margin: "0 0 20px", fontSize: "18px", color: "#f0f0f0", fontWeight: "700" }}>New Project</h3>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
          style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "#f0f0f0", fontSize: "16px", padding: "12px 14px", outline: "none", marginBottom: "12px", boxSizing: "border-box" }} />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description (optional)" rows={2}
          style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", color: "#ccc", fontSize: "14px", padding: "10px 14px", outline: "none", resize: "none", marginBottom: "16px", fontFamily: "inherit", boxSizing: "border-box" }} />

        <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "8px" }}>Tasks (optional)</label>
        {tasks.length > 0 && (
          <div style={{ marginBottom: "8px" }}>
            {tasks.map((task) => (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ width: "16px", height: "16px", minWidth: "16px", borderRadius: "4px", border: `2px solid ${stg.color}55`, display: "inline-block" }} />
                <span style={{ flex: 1, fontSize: "13px", color: "#ccc" }}>{task.text}</span>
                <button onClick={() => removeTask(task.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "14px", padding: "0 4px", lineHeight: 1 }}
                  onMouseEnter={(e) => (e.target.style.color = "#ef4444")} onMouseLeave={(e) => (e.target.style.color = "#444")}>×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="Add a task…"
            style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "13px", padding: "8px 12px", outline: "none" }} />
          <button onClick={addTask} style={{ background: `${stg.color}33`, border: `1px solid ${stg.color}55`, borderRadius: "8px", color: stg.color, padding: "8px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Add</button>
        </div>

        {/* Milestones */}
        <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "8px" }}>Milestones (optional)</label>
        {milestones.map((milestone) => (
          <div key={milestone.id} style={{ marginBottom: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: milestone.tasks.length > 0 ? "8px" : "0" }}>
              <span style={{ fontWeight: "600", fontSize: "13px", color: "#e0e0e0", flex: 1 }}>{milestone.name}</span>
              {milestone.tasks.length > 0 && <span style={{ fontSize: "11px", color: "#777" }}>{milestone.tasks.length} tasks</span>}
              <button onClick={() => removeMilestone(milestone.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "14px", padding: "0 4px" }}
                onMouseEnter={(e) => (e.target.style.color = "#ef4444")} onMouseLeave={(e) => (e.target.style.color = "#444")}>×</button>
            </div>
            {milestone.tasks.map((task) => (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0 4px 16px", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ width: "14px", height: "14px", minWidth: "14px", borderRadius: "3px", border: `2px solid ${stg.color}44`, display: "inline-block" }} />
                <span style={{ flex: 1, fontSize: "12px", color: "#bbb" }}>{task.text}</span>
                <button onClick={() => removeMilestoneTask(milestone.id, task.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "12px", padding: "0 4px" }}
                  onMouseEnter={(e) => (e.target.style.color = "#ef4444")} onMouseLeave={(e) => (e.target.style.color = "#444")}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: "6px", marginTop: "6px", paddingLeft: "16px" }}>
              <input value={milestoneNewTask[milestone.id] || ""} onChange={(e) => setMilestoneNewTask((prev) => ({ ...prev, [milestone.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addMilestoneTask(milestone.id)} placeholder="Add task to milestone…"
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", color: "#ccc", fontSize: "12px", padding: "6px 10px", outline: "none" }} />
              <button onClick={() => addMilestoneTask(milestone.id)} style={{ background: `${stg.color}22`, border: `1px solid ${stg.color}44`, borderRadius: "6px", color: stg.color, padding: "6px 10px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>Add</button>
            </div>
          </div>
        ))}
        {showNewMilestone ? (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <input autoFocus value={newMilestoneName} onChange={(e) => setNewMilestoneName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMilestone(); if (e.key === "Escape") { setShowNewMilestone(false); setNewMilestoneName(""); } }} placeholder="Milestone name…"
              style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#ccc", fontSize: "13px", padding: "8px 12px", outline: "none" }} />
            <button onClick={addMilestone} style={{ background: stg.color, border: "none", borderRadius: "8px", color: "#fff", padding: "8px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Add</button>
            <button onClick={() => { setShowNewMilestone(false); setNewMilestoneName(""); }} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "8px", color: "#888", padding: "8px 10px", cursor: "pointer", fontSize: "12px" }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowNewMilestone(true)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "8px", color: "#777", padding: "8px 14px", cursor: "pointer", fontSize: "12px", width: "100%", marginBottom: "16px", transition: "all 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#bbb"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#777"; }}>
            + Add Milestone
          </button>
        )}

        <label style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#666", display: "block", marginBottom: "8px" }}>Starting Stage</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
          {STAGES.filter((s) => s.id !== "done").map((s) => (
            <button key={s.id} onClick={() => setStage(s.id)}
              style={{ background: stage === s.id ? `${s.color}33` : "rgba(255,255,255,0.04)", border: stage === s.id ? `1px solid ${s.color}` : "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: stage === s.id ? s.color : "#888", fontSize: "12px", padding: "6px 12px", cursor: "pointer", fontWeight: stage === s.id ? "600" : "400" }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "8px", color: "#888", padding: "10px 20px", cursor: "pointer", fontSize: "14px" }}>Cancel</button>
          <button onClick={create} style={{ background: "#f59e0b", border: "none", borderRadius: "8px", color: "#000", padding: "10px 24px", cursor: "pointer", fontSize: "14px", fontWeight: "700" }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ─── Nudge Banner ───
function NudgeBanner({ projects }) {
  const active = projects.filter((p) => p.stage === "building");
  const stale = projects.filter((p) => p.stage !== "done" && p.stage !== "paused" && (Date.now() - p.lastTouchedAt) / 86400000 > 7);
  const newP = projects.filter((p) => Date.now() - p.createdAt < 7 * 86400000).length;
  const doneT = projects.reduce((s, p) => s + getAllTasks(p).filter((t) => t.done && t.completedAt && Date.now() - t.completedAt < 7 * 86400000).length, 0);

  let nudge = null;
  if (active.length > 3) nudge = { text: `You have ${active.length} active projects. Can you pause one to focus better?`, color: "#f59e0b", icon: "⚡" };
  else if (stale.length > 0) nudge = { text: `"${stale[0].name}" hasn't been touched in over a week. Move it forward or park it?`, color: "#ef4444", icon: "👀" };
  else if (newP > 2 && doneT === 0) nudge = { text: `${newP} new projects this week but 0 tasks completed. Finish something first!`, color: "#f59e0b", icon: "🎯" };
  if (!nudge) return null;

  return (
    <div style={{ background: `${nudge.color}11`, border: `1px solid ${nudge.color}33`, borderRadius: "10px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: nudge.color }}>
      <span style={{ fontSize: "18px" }}>{nudge.icon}</span><span>{nudge.text}</span>
    </div>
  );
}

// ─── Global Task View ───
function GlobalTaskView({ projects, onToggleTask, onEditTask, onFlagTask, onSelectProject }) {
  const [showCompleted, setShowCompleted] = useState(true);
  const [groupMode, setGroupMode] = useState("project"); // "flat", "project", "milestone"

  // Flatten all tasks from all projects (loose + milestone tasks) with context
  const allTasks = projects.flatMap((p) => {
    const stg = STAGES.find((s) => s.id === p.stage);
    const loose = (p.tasks || []).map((t) => ({ ...t, projectId: p.id, projectName: p.name, projectStage: p.stage, stageColor: stg?.color || "#888", stageEmoji: stg?.emoji || "", milestoneId: null, milestoneName: null }));
    const fromMilestones = (p.milestones || []).flatMap((m) => (m.tasks || []).map((t) => ({ ...t, projectId: p.id, projectName: p.name, projectStage: p.stage, stageColor: stg?.color || "#888", stageEmoji: stg?.emoji || "", milestoneId: m.id, milestoneName: m.name })));
    return [...loose, ...fromMilestones];
  });

  const filtered = showCompleted ? allTasks : allTasks.filter((t) => !t.done);
  const totalIncomplete = allTasks.filter((t) => !t.done).length;
  const totalComplete = allTasks.filter((t) => t.done).length;

  if (allTasks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>📝</div>
        <div style={{ fontSize: "16px", marginBottom: "6px", color: "#888" }}>No tasks yet</div>
        <div style={{ fontSize: "13px" }}>Open a project and add some tasks to see them here.</div>
      </div>
    );
  }

  // Stage ordering: building first, then planned, shaping, spark, paused, done
  const stageOrder = STAGES.map((s) => s.id);

  // Group tasks by project
  const groupedByProject = {};
  filtered.forEach((t) => {
    if (!groupedByProject[t.projectId]) groupedByProject[t.projectId] = { name: t.projectName, stage: t.projectStage, color: t.stageColor, emoji: t.stageEmoji, tasks: [] };
    groupedByProject[t.projectId].tasks.push(t);
  });
  const sortedByProject = Object.entries(groupedByProject).sort(([, a], [, b]) => {
    const ai = stageOrder.indexOf(a.stage), bi = stageOrder.indexOf(b.stage);
    // Building (3) first, then planned (2), shaping (1), spark (0), paused (4), done (5)
    const priority = [4, 3, 2, 1, 5, 6]; // spark=4, shaping=3, planned=2, building=1, paused=5, done=6
    return (priority[ai] || 9) - (priority[bi] || 9);
  });

  // Group tasks by milestone (project → milestone)
  const groupedByMilestone = {};
  filtered.forEach((t) => {
    const key = t.milestoneId ? `${t.projectId}::${t.milestoneId}` : `${t.projectId}::_loose`;
    if (!groupedByMilestone[key]) groupedByMilestone[key] = { projectName: t.projectName, milestoneName: t.milestoneName, color: t.stageColor, emoji: t.stageEmoji, projectId: t.projectId, stage: t.projectStage, tasks: [] };
    groupedByMilestone[key].tasks.push(t);
  });
  const sortedByMilestone = Object.entries(groupedByMilestone).sort(([, a], [, b]) => {
    const priority = [4, 3, 2, 1, 5, 6];
    const ai = stageOrder.indexOf(a.stage), bi = stageOrder.indexOf(b.stage);
    return (priority[ai] || 9) - (priority[bi] || 9);
  });

  const groupModes = [
    { id: "flat", label: "Flat list" },
    { id: "project", label: "By project" },
    { id: "milestone", label: "By milestone" },
  ];

  return (
    <div>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ fontSize: "14px", color: "#999" }}>
          <span style={{ color: "#f0f0f0", fontWeight: "600" }}>{totalIncomplete}</span> remaining
          {totalComplete > 0 && <span> · {totalComplete} done</span>}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
            {groupModes.map((gm) => (
              <button key={gm.id} onClick={() => setGroupMode(gm.id)}
                style={{ background: groupMode === gm.id ? "rgba(255,255,255,0.1)" : "transparent", border: "none", color: groupMode === gm.id ? "#f0f0f0" : "#777", padding: "6px 10px", cursor: "pointer", fontSize: "11px", fontWeight: groupMode === gm.id ? "600" : "400", transition: "all 0.15s", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                {gm.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCompleted(!showCompleted)}
            style={{ background: showCompleted ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)", border: showCompleted ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: showCompleted ? "#10b981" : "#aaa", padding: "6px 12px", cursor: "pointer", fontSize: "12px" }}>
            {showCompleted ? "Hide completed" : "Show completed"}
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#555" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎉</div>
          <div style={{ fontSize: "14px", color: "#888" }}>All tasks complete! Nice work.</div>
        </div>
      )}

      {groupMode === "project" ? (
        sortedByProject.map(([pid, group]) => (
          <div key={pid} style={{ marginBottom: "20px" }}>
            <div onClick={() => onSelectProject(projects.find((p) => p.id === pid))}
              style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer", padding: "4px 0" }}
              onMouseEnter={(e) => (e.currentTarget.querySelector('.proj-name').style.color = group.color)}
              onMouseLeave={(e) => (e.currentTarget.querySelector('.proj-name').style.color = "#ccc")}>
              <span style={{ fontSize: "14px" }}>{group.emoji}</span>
              <span className="proj-name" style={{ fontWeight: "600", fontSize: "14px", color: "#ccc", transition: "color 0.15s" }}>{group.name}</span>
              <span style={{ fontSize: "11px", color: "#555", background: `${group.color}18`, padding: "2px 8px", borderRadius: "8px" }}>{group.stage}</span>
              <span style={{ fontSize: "11px", color: "#666" }}>({group.tasks.length})</span>
            </div>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={() => onToggleTask(task.projectId, task.id, task.milestoneId)} onEditTask={onEditTask} onFlagTask={onFlagTask} stageColor={group.color} showProject={false} showMilestone={!!task.milestoneName} onClickProject={() => {}} />
            ))}
          </div>
        ))
      ) : groupMode === "milestone" ? (
        sortedByMilestone.map(([key, group]) => (
          <div key={key} style={{ marginBottom: "20px" }}>
            <div onClick={() => onSelectProject(projects.find((p) => p.id === group.projectId))}
              style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer", padding: "4px 0", flexWrap: "wrap" }}>
              <span style={{ fontSize: "14px" }}>{group.emoji}</span>
              <span style={{ fontWeight: "600", fontSize: "13px", color: "#999" }}>{group.projectName}</span>
              {group.milestoneName ? (
                <><span style={{ color: "#555", fontSize: "12px" }}>→</span><span style={{ fontWeight: "600", fontSize: "14px", color: "#ccc" }}>{group.milestoneName}</span></>
              ) : (
                <span style={{ fontSize: "12px", color: "#666", fontStyle: "italic" }}>Loose tasks</span>
              )}
              <span style={{ fontSize: "11px", color: "#666" }}>({group.tasks.length})</span>
            </div>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={() => onToggleTask(task.projectId, task.id, task.milestoneId)} onEditTask={onEditTask} onFlagTask={onFlagTask} stageColor={group.color} showProject={false} showMilestone={false} onClickProject={() => {}} />
            ))}
          </div>
        ))
      ) : (
        filtered.map((task) => (
          <TaskRow key={`${task.projectId}-${task.milestoneId || "l"}-${task.id}`} task={task} onToggle={() => onToggleTask(task.projectId, task.id, task.milestoneId)} onEditTask={onEditTask} onFlagTask={onFlagTask} stageColor={task.stageColor} showProject={true} showMilestone={!!task.milestoneName}
            onClickProject={() => onSelectProject(projects.find((p) => p.id === task.projectId))} />
        ))
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onEditTask, onFlagTask, stageColor, showProject, showMilestone, onClickProject }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const flagStatus = getFlagStatus(task);

  const saveEdit = () => { if (editText.trim() && editText.trim() !== task.text) { onEditTask(task.projectId, task.id, editText.trim(), task.milestoneId); } setEditing(false); };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", background: flagStatus === "today" ? "rgba(245,158,11,0.06)" : flagStatus === "stale" ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.03)", borderRadius: "8px", marginBottom: "4px", border: flagStatus === "today" ? "1px solid rgba(245,158,11,0.15)" : flagStatus === "stale" ? "1px solid rgba(239,68,68,0.12)" : "1px solid rgba(255,255,255,0.04)", transition: "background 0.15s" }}
      onMouseEnter={(e) => { if (!flagStatus) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { if (!flagStatus) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}>
      <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
        style={{ width: "20px", height: "20px", minWidth: "20px", borderRadius: "6px", border: task.done ? "none" : `2px solid ${stageColor}55`, background: task.done ? stageColor : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "12px", marginTop: "1px", transition: "all 0.15s" }}>
        {task.done && "✓"}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") { setEditText(task.text); setEditing(false); } }}
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "#ddd", fontSize: "14px", padding: "4px 8px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
        ) : (
          <span onClick={() => { setEditText(task.text); setEditing(true); }} style={{ fontSize: "14px", color: task.done ? "#555" : "#ddd", textDecoration: task.done ? "line-through" : "none", lineHeight: "1.4", cursor: "pointer", borderRadius: "4px", padding: "2px 4px", margin: "-2px -4px", display: "inline-block" }}
            onMouseEnter={(e) => { if (!task.done) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{task.text}</span>
        )}
        {!editing && (showProject || showMilestone) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
            {showProject && (
              <span onClick={onClickProject} style={{ fontSize: "11px", color: stageColor, background: `${stageColor}18`, padding: "1px 8px", borderRadius: "6px", fontWeight: "500", cursor: "pointer" }}>{task.projectName}</span>
            )}
            {showMilestone && task.milestoneName && (
              <span style={{ fontSize: "11px", color: "#888", background: "rgba(255,255,255,0.06)", padding: "1px 8px", borderRadius: "6px" }}>{task.milestoneName}</span>
            )}
          </span>
        )}
      </div>
      {!task.done && onFlagTask && (
        <button onClick={(e) => { e.stopPropagation(); onFlagTask(task.projectId, task.id, task.milestoneId); }}
          title={flagStatus === "today" ? "Remove from today" : flagStatus === "stale" ? "Carried over — click to reflag for today or remove" : "Add to today's plan"}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", padding: "2px 4px", opacity: flagStatus ? 1 : 0.3, transition: "opacity 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { if (!flagStatus) e.currentTarget.style.opacity = "0.3"; }}>
          {flagStatus === "stale" ? "🔸" : "☀️"}
        </button>
      )}
    </div>
  );
}

// ─── Today View ───
function TodayView({ projects, onToggleTask, onEditTask, onFlagTask, onSelectProject }) {
  const [showCompleted, setShowCompleted] = useState(true);
  const today = getToday();

  // Get all flagged tasks (today + stale) across all projects
  const allTasks = projects.flatMap((p) => {
    const stg = STAGES.find((s) => s.id === p.stage);
    const loose = (p.tasks || []).map((t) => ({ ...t, projectId: p.id, projectName: p.name, projectStage: p.stage, stageColor: stg?.color || "#888", stageEmoji: stg?.emoji || "", milestoneId: null, milestoneName: null }));
    const fromMilestones = (p.milestones || []).flatMap((m) => (m.tasks || []).map((t) => ({ ...t, projectId: p.id, projectName: p.name, projectStage: p.stage, stageColor: stg?.color || "#888", stageEmoji: stg?.emoji || "", milestoneId: m.id, milestoneName: m.name })));
    return [...loose, ...fromMilestones];
  }).filter((t) => t.flaggedFor);

  const todayTasks = allTasks.filter((t) => !t.done && t.flaggedFor === today);
  const staleTasks = allTasks.filter((t) => !t.done && t.flaggedFor < today);
  const completedTasks = allTasks.filter((t) => t.done);
  const activeTasks = [...todayTasks, ...staleTasks];
  const displayTasks = showCompleted ? [...activeTasks, ...completedTasks] : activeTasks;

  // Group by project, sorted by stage
  const stageOrder = STAGES.map((s) => s.id);
  const stagePriority = [4, 3, 2, 1, 5, 6];
  const grouped = {};
  displayTasks.forEach((t) => {
    if (!grouped[t.projectId]) grouped[t.projectId] = { name: t.projectName, stage: t.projectStage, color: t.stageColor, emoji: t.stageEmoji, tasks: [] };
    grouped[t.projectId].tasks.push(t);
  });
  const sorted = Object.entries(grouped).sort(([, a], [, b]) => {
    const ai = stageOrder.indexOf(a.stage), bi = stageOrder.indexOf(b.stage);
    return (stagePriority[ai] || 9) - (stagePriority[bi] || 9);
  });

  if (allTasks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>☀️</div>
        <div style={{ fontSize: "16px", marginBottom: "6px", color: "#888" }}>No tasks planned for today</div>
        <div style={{ fontSize: "13px" }}>Go to the Tasks view and click the ☀️ icon on tasks you want to work on today.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ fontSize: "14px", color: "#999" }}>
          {todayTasks.length > 0 && <span><span style={{ color: "#f59e0b", fontWeight: "600" }}>{todayTasks.length}</span> for today</span>}
          {staleTasks.length > 0 && <span>{todayTasks.length > 0 ? " · " : ""}<span style={{ color: "#ef4444", fontWeight: "600" }}>{staleTasks.length}</span> carried over</span>}
          {completedTasks.length > 0 && <span> · {completedTasks.length} done</span>}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => setShowCompleted(!showCompleted)}
            style={{ background: showCompleted ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)", border: showCompleted ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: showCompleted ? "#10b981" : "#aaa", padding: "6px 12px", cursor: "pointer", fontSize: "12px" }}>
            {showCompleted ? "Hide completed" : "Show completed"}
          </button>
        </div>
      </div>

      {activeTasks.length === 0 && completedTasks.length > 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#555", marginBottom: "16px" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎉</div>
          <div style={{ fontSize: "14px", color: "#888" }}>Today's tasks are done! Nice work.</div>
        </div>
      )}

      {sorted.map(([pid, group]) => (
        <div key={pid} style={{ marginBottom: "20px" }}>
          <div onClick={() => onSelectProject(projects.find((p) => p.id === pid))}
            style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer", padding: "4px 0" }}
            onMouseEnter={(e) => (e.currentTarget.querySelector('.proj-name').style.color = group.color)}
            onMouseLeave={(e) => (e.currentTarget.querySelector('.proj-name').style.color = "#ccc")}>
            <span style={{ fontSize: "14px" }}>{group.emoji}</span>
            <span className="proj-name" style={{ fontWeight: "600", fontSize: "14px", color: "#ccc", transition: "color 0.15s" }}>{group.name}</span>
            <span style={{ fontSize: "11px", color: "#555", background: `${group.color}18`, padding: "2px 8px", borderRadius: "8px" }}>{group.stage}</span>
          </div>
          {group.tasks.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={() => onToggleTask(task.projectId, task.id, task.milestoneId)} onEditTask={onEditTask} onFlagTask={onFlagTask} stageColor={group.color} showProject={false} showMilestone={!!task.milestoneName} onClickProject={() => {}} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Sync Status ───
function SyncStatus({ status }) {
  const c = { synced: "#10b981", saving: "#f59e0b", error: "#ef4444", loading: "#3b82f6" };
  const l = { synced: "Synced", saving: "Saving…", error: "Sync error", loading: "Loading…" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: c[status] || "#666" }}>
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: c[status] || "#666", animation: status === "saving" || status === "loading" ? "pulse 1s infinite" : "none" }} />
      {l[status] || status}
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
    </div>
  );
}

// ─── Main App ───
export default function Forge() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [view, setView] = useState("pipeline");
  const [syncStatus, setSyncStatus] = useState("loading");

  useEffect(() => {
    supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      setAuthChecked(true);
      if (session) { supabase.auth.startAutoRefresh(); }
      else { supabase.auth.stopAutoRefresh(); }
    });
    const t = setTimeout(() => setAuthChecked(true), 2500);
    return () => { clearTimeout(t); supabase.auth.stopAutoRefresh(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setSyncStatus("loading");
      try {
        const { data } = await supabase.from("projects").select();
        setProjects((data || []).map(dbToProject));
        setSyncStatus("synced");
      } catch (e) { console.error("Load error:", e); setSyncStatus("error"); }
    })();
  }, [user]);

  const save = useCallback(async (project) => {
    setSyncStatus("saving");
    try { await supabase.from("projects").upsert(projectToDb(project)); setSyncStatus("synced"); }
    catch (e) { console.error("Save error:", e); setSyncStatus("error"); }
  }, []);

  const handleAdd = async (p) => { setProjects((prev) => [...prev, p]); setShowNewForm(false); await save(p); };
  const handleUpdate = async (u) => { setProjects((prev) => prev.map((p) => (p.id === u.id ? u : p))); setSelectedProject(u); await save(u); };
  const handleDelete = async (id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setSyncStatus("saving");
    try { await supabase.from("projects").delete().eq("id", id).execute(); setSyncStatus("synced"); }
    catch (e) { console.error("Delete error:", e); setSyncStatus("error"); }
  };
  const handleToggleTask = async (projectId, taskId, milestoneId) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    let u;
    if (milestoneId) {
      const updatedMilestones = (p.milestones || []).map((m) => m.id === milestoneId ? { ...m, tasks: m.tasks.map((t) => t.id === taskId ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : null } : t) } : m);
      u = { ...p, milestones: updatedMilestones, lastTouchedAt: Date.now() };
    } else {
      const updatedTasks = p.tasks.map((t) => t.id === taskId ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : null } : t);
      u = { ...p, tasks: updatedTasks, lastTouchedAt: Date.now() };
    }
    setProjects((prev) => prev.map((x) => (x.id === projectId ? u : x)));
    await save(u);
  };
  const handleEditTask = async (projectId, taskId, newText, milestoneId) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    let u;
    if (milestoneId) {
      const updatedMilestones = (p.milestones || []).map((m) => m.id === milestoneId ? { ...m, tasks: m.tasks.map((t) => t.id === taskId ? { ...t, text: newText } : t) } : m);
      u = { ...p, milestones: updatedMilestones, lastTouchedAt: Date.now() };
    } else {
      const updatedTasks = p.tasks.map((t) => t.id === taskId ? { ...t, text: newText } : t);
      u = { ...p, tasks: updatedTasks, lastTouchedAt: Date.now() };
    }
    setProjects((prev) => prev.map((x) => (x.id === projectId ? u : x)));
    await save(u);
  };
  const handleFlagTask = async (projectId, taskId, milestoneId) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    const today = getToday();
    const toggleFlag = (t) => {
      if (t.id !== taskId) return t;
      // If flagged for today → unflag. If stale → reflag for today. If unflagged → flag for today.
      if (t.flaggedFor === today) return { ...t, flaggedFor: null };
      return { ...t, flaggedFor: today };
    };
    let u;
    if (milestoneId) {
      const updatedMilestones = (p.milestones || []).map((m) => m.id === milestoneId ? { ...m, tasks: m.tasks.map(toggleFlag) } : m);
      u = { ...p, milestones: updatedMilestones, lastTouchedAt: Date.now() };
    } else {
      u = { ...p, tasks: p.tasks.map(toggleFlag), lastTouchedAt: Date.now() };
    }
    setProjects((prev) => prev.map((x) => (x.id === projectId ? u : x)));
    await save(u);
  };
  const handleDrop = async (pid, newStage) => {
    const p = projects.find((x) => x.id === pid);
    if (!p) return;
    const u = { ...p, stage: newStage, lastTouchedAt: Date.now() };
    setProjects((prev) => prev.map((x) => (x.id === pid ? u : x)));
    setDraggingId(null);
    await save(u);
  };

  if (!authChecked) return (
    <div style={{ background: "#111114", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: "40px", marginBottom: "16px" }}>🔥</div><div>Loading…</div></div>
    </div>
  );

  if (!user) return <LoginScreen />;

  return (
    <div style={{ background: "#111114", minHeight: "100vh", color: "#e8e8e8", fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />

      <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "28px" }}>🔥</span>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: "700", fontFamily: "'Space Grotesk', sans-serif", color: "#f59e0b", letterSpacing: "-0.5px" }}>THE FORGE</h1>
            <span style={{ fontSize: "11px", color: "#555", letterSpacing: "2px", textTransform: "uppercase" }}>idea → execution</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <SyncStatus status={syncStatus} />
          <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
            {[
              { id: "pipeline", label: "Pipeline", icon: "🔀" },
              { id: "list", label: "List", icon: "📋" },
              { id: "tasks", label: "Tasks", icon: "✓" },
              { id: "today", label: `Today${getTodayCount(projects) > 0 ? ` (${getTodayCount(projects)})` : ""}`, icon: "☀️" },
            ].map((tab) => (
              <button key={tab.id} onClick={() => setView(tab.id)}
                style={{ background: view === tab.id ? "rgba(255,255,255,0.1)" : "transparent", border: "none", color: view === tab.id ? "#f0f0f0" : "#777", padding: "8px 14px", cursor: "pointer", fontSize: "13px", fontWeight: view === tab.id ? "600" : "400", transition: "all 0.15s ease", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowNewForm(true)}
            style={{ background: "#f59e0b", border: "none", borderRadius: "8px", color: "#000", padding: "8px 18px", cursor: "pointer", fontSize: "14px", fontWeight: "700" }}>+ New Project</button>
          <button onClick={() => supabase.auth.signOut()}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#888", padding: "8px 14px", cursor: "pointer", fontSize: "12px" }}
            title={user.email}>Sign out</button>
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        <FocusStats projects={projects} />
        <NudgeBanner projects={projects} />

        {view === "pipeline" ? (
          <div style={{ display: "flex", gap: "14px", overflowX: "auto", paddingBottom: "20px" }}>
            {STAGES.map((stage) => <PipelineColumn key={stage.id} stage={stage} projects={projects.filter((p) => p.stage === stage.id)} onSelect={setSelectedProject} onDrop={handleDrop} draggingId={draggingId} />)}
          </div>
        ) : view === "tasks" ? (
          <GlobalTaskView projects={projects} onToggleTask={handleToggleTask} onEditTask={handleEditTask} onFlagTask={handleFlagTask} onSelectProject={setSelectedProject} />
        ) : view === "today" ? (
          <TodayView projects={projects} onToggleTask={handleToggleTask} onEditTask={handleEditTask} onFlagTask={handleFlagTask} onSelectProject={setSelectedProject} />
        ) : (
          <div>
            {STAGES.map((stage) => {
              const sp = projects.filter((p) => p.stage === stage.id);
              if (!sp.length) return null;
              return (
                <div key={stage.id} style={{ marginBottom: "24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <span>{stage.emoji}</span>
                    <span style={{ fontWeight: "700", color: stage.color, fontSize: "14px" }}>{stage.label}</span>
                    <span style={{ color: "#555", fontSize: "13px" }}>({sp.length})</span>
                  </div>
                  {sp.map((p) => {
                    const allT = getAllTasks(p); const d = allT.filter((t) => t.done).length; const tt = allT.length; const days = Math.floor((Date.now() - p.lastTouchedAt) / 86400000);
                    return (
                      <div key={p.id} onClick={() => setSelectedProject(p)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", marginBottom: "6px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.06)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}>
                        <div>
                          <div style={{ fontWeight: "600", fontSize: "14px", color: "#e0e0e0" }}>{p.name}</div>
                          {p.description && <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>{p.description.slice(0, 60)}{p.description.length > 60 ? "…" : ""}</div>}
                        </div>
                        <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "12px", color: "#666" }}>
                          {tt > 0 && <span>{d}/{tt} tasks</span>}
                          <span style={{ color: days > 7 ? "#ef4444" : days > 3 ? "#f59e0b" : "#666" }}>{days === 0 ? "Today" : `${days}d ago`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedProject && <ProjectDetail project={projects.find((p) => p.id === selectedProject.id) || selectedProject} onClose={() => setSelectedProject(null)} onUpdate={handleUpdate} onDelete={handleDelete} />}
      {showNewForm && <NewProjectForm onAdd={handleAdd} onCancel={() => setShowNewForm(false)} />}
    </div>
  );
}

