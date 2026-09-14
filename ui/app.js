(() => {
  "use strict";
  const initial = window.__TRIATHLON__;
  let board = initial.board;
  let revision = initial.revision;
  let query = "";
  let sprintFilter = "all";
  let draggedTicketId = null;
  const root = document.querySelector("#app");

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const column = (id) => board.board.columns.find((item) => item.id === id);
  const activeSprint = () => Object.values(board.sprints).find((sprint) => sprint.state === "active");
  const ticketsIn = (columnId) => Object.values(board.tickets)
    .filter((ticket) => ticket.columnId === columnId)
    .filter((ticket) => sprintFilter === "all" || (sprintFilter === "none" ? ticket.sprintId === null : ticket.sprintId === sprintFilter))
    .filter((ticket) => `${ticket.id} ${ticket.title} ${ticket.labels.join(" ")} ${ticket.assignee ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id, undefined, { numeric: true }));

  function status(message, error = false) {
    const element = document.querySelector("#save-state");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  async function save() {
    if (!initial.editable) return;
    status("Saving…");
    try {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": revision },
        body: JSON.stringify(board),
      });
      const result = await response.json();
      if (!response.ok) throw new Error([result.error, ...(result.problems ?? [])].filter(Boolean).join("\n"));
      board = result.board;
      revision = result.revision;
      render();
      status("Saved to board.json");
    } catch (error) {
      status(error.message, true);
      window.alert(error.message);
    }
  }

  function ticketCard(ticket) {
    const priorityColors = { low: "#78909c", medium: "#257b67", high: "#e08b2f", urgent: "#b53e2e" };
    const sprint = ticket.sprintId ? board.sprints[ticket.sprintId] : null;
    return `<button class="card" data-ticket="${escape(ticket.id)}" ${initial.editable ? 'draggable="true"' : ""}>
      <span class="ticket-top"><span class="ticket-id">${escape(ticket.id)}</span><span class="priority" style="--priority:${priorityColors[ticket.priority]}" title="${escape(ticket.priority)} priority"></span></span>
      <h3>${escape(ticket.title)}</h3>
      <span class="ticket-foot">
        ${ticket.assignee ? `<span title="Assignee">@${escape(ticket.assignee)}</span>` : ""}
        ${ticket.labels[0] ? `<span class="label">${escape(ticket.labels[0])}</span>` : ""}
        ${sprint ? `<span class="label">${escape(sprint.name)}</span>` : ""}
        ${ticket.storyPoints !== null ? `<span class="points">${ticket.storyPoints} pt</span>` : ""}
      </span>
    </button>`;
  }

  function render() {
    const sprint = activeSprint();
    root.innerHTML = `<main class="shell">
      <header class="topbar">
        <div class="brand"><span class="mark" aria-hidden="true"></span><div class="brand-copy"><span class="eyebrow">${escape(board.project.key)} board</span><h1>${escape(board.project.name)}</h1></div></div>
        <div class="sprint-pulse"><div><span>Active sprint</span><strong>${sprint ? escape(sprint.name) : "No active sprint"}</strong></div></div>
        <div class="actions">
          ${initial.editable ? '<button class="button quiet" id="sprints">Sprints</button><button class="button quiet" id="metrics">Metrics</button><button class="button primary" id="new-ticket">New ticket</button>' : '<span class="readonly">Read-only snapshot</span>'}
        </div>
      </header>
      <section class="toolbar" aria-label="Board filters">
        <input class="search" id="search" type="search" value="${escape(query)}" placeholder="Search tickets" aria-label="Search tickets">
        <select class="select" id="sprint-filter" aria-label="Filter by sprint">
          <option value="all">All sprints</option><option value="none" ${sprintFilter === "none" ? "selected" : ""}>No sprint</option>
          ${Object.values(board.sprints).map((item) => `<option value="${escape(item.id)}" ${sprintFilter === item.id ? "selected" : ""}>${escape(item.name)}</option>`).join("")}
        </select>
        <span class="save-state" id="save-state">${initial.editable ? `Editing as ${escape(initial.author)}` : "Generated from board.json"}</span>
      </section>
      <section class="board" aria-label="Ticket board">
        ${board.board.columns.map((item) => {
          const tickets = ticketsIn(item.id);
          const colors = { "not-started": "#77786f", started: "#2e7390", done: "#257b67" };
          return `<section class="column" style="--column-color:${colors[item.category]}" data-column="${escape(item.id)}">
            <header class="column-header"><div class="column-title"><h2>${escape(item.name)}</h2><p>${escape(item.category.replace("-", " "))}${item.wipLimit ? ` · WIP ${item.wipLimit}` : ""}</p></div><span class="count">${tickets.length}</span></header>
            <div class="cards" data-drop-column="${escape(item.id)}">${tickets.length ? tickets.map(ticketCard).join("") : '<div class="empty">No matching tickets</div>'}</div>
          </section>`;
        }).join("")}
      </section>
    </main>`;
    bind();
  }

  function bind() {
    document.querySelector("#search").addEventListener("input", (event) => { query = event.target.value; render(); document.querySelector("#search").focus(); });
    document.querySelector("#sprint-filter").addEventListener("change", (event) => { sprintFilter = event.target.value; render(); });
    document.querySelectorAll("[data-ticket]").forEach((element) => {
      element.addEventListener("click", () => openTicket(element.dataset.ticket));
      if (!initial.editable) return;
      element.addEventListener("dragstart", () => { draggedTicketId = element.dataset.ticket; element.classList.add("dragging"); });
      element.addEventListener("dragend", () => { draggedTicketId = null; element.classList.remove("dragging"); });
    });
    if (!initial.editable) return;
    document.querySelectorAll("[data-drop-column]").forEach((element) => {
      element.addEventListener("dragover", (event) => { event.preventDefault(); element.classList.add("dragover"); });
      element.addEventListener("dragleave", () => element.classList.remove("dragover"));
      element.addEventListener("drop", async (event) => {
        event.preventDefault(); element.classList.remove("dragover");
        if (!draggedTicketId) return;
        const ticket = board.tickets[draggedTicketId];
        const target = element.dataset.dropColumn;
        if (ticket.columnId === target) return;
        ticket.columnId = target;
        ticket.rank = Math.max(0, ...Object.values(board.tickets).filter((item) => item.columnId === target).map((item) => item.rank)) + 1000;
        ticket.updatedAt = new Date().toISOString();
        render();
        await save();
      });
    });
    document.querySelector("#new-ticket").addEventListener("click", () => openTicket());
    document.querySelector("#sprints").addEventListener("click", openSprints);
    document.querySelector("#metrics").addEventListener("click", openMetrics);
  }

  function modal(title, content, actions = "") {
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-label="${escape(title)}"><header class="modal-head"><div><span class="eyebrow">Triathlon</span><h2>${escape(title)}</h2></div><button class="close" aria-label="Close">×</button></header>${content}${actions ? `<footer class="modal-actions">${actions}</footer>` : ""}</section></div>`);
    const backdrop = document.querySelector(".modal-backdrop");
    backdrop.querySelector(".close").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    return backdrop;
  }

  function openTicket(id) {
    const isNew = !id;
    const ticket = isNew ? {
      id: `${board.project.key}-${board.project.nextTicketNumber}`, title: "", description: "", columnId: board.board.columns[0].id,
      rank: 1000, priority: "medium", storyPoints: null, labels: [], assignee: null, sprintId: activeSprint()?.id ?? null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [],
    } : structuredClone(board.tickets[id]);
    const content = `<form class="form" id="ticket-form">
      <div class="field full"><label for="title">Title</label><input id="title" name="title" required value="${escape(ticket.title)}" ${initial.editable ? "" : "disabled"}></div>
      <div class="field full"><label for="description">Description (Markdown)</label><textarea id="description" name="description" ${initial.editable ? "" : "disabled"}>${escape(ticket.description)}</textarea></div>
      <div class="field"><label for="columnId">Column</label><select id="columnId" name="columnId" ${initial.editable ? "" : "disabled"}>${board.board.columns.map((item) => `<option value="${escape(item.id)}" ${item.id === ticket.columnId ? "selected" : ""}>${escape(item.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="priority">Priority</label><select id="priority" name="priority" ${initial.editable ? "" : "disabled"}>${["low", "medium", "high", "urgent"].map((value) => `<option ${value === ticket.priority ? "selected" : ""}>${value}</option>`).join("")}</select></div>
      <div class="field"><label for="storyPoints">Story points</label><input id="storyPoints" name="storyPoints" type="number" min="0" value="${ticket.storyPoints ?? ""}" ${initial.editable ? "" : "disabled"}></div>
      <div class="field"><label for="assignee">Assignee</label><input id="assignee" name="assignee" value="${escape(ticket.assignee ?? "")}" placeholder="GitHub username" ${initial.editable ? "" : "disabled"}></div>
      <div class="field"><label for="sprintId">Sprint</label><select id="sprintId" name="sprintId" ${initial.editable ? "" : "disabled"}><option value="">No sprint</option>${Object.values(board.sprints).filter((item) => item.state !== "completed" || item.id === ticket.sprintId).map((item) => `<option value="${escape(item.id)}" ${item.id === ticket.sprintId ? "selected" : ""}>${escape(item.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="labels">Labels</label><input id="labels" name="labels" value="${escape(ticket.labels.join(", "))}" placeholder="frontend, urgent" ${initial.editable ? "" : "disabled"}></div>
      <section class="comments"><span class="meta-label">Comments · ${ticket.comments.length}</span>${ticket.comments.map((comment) => `<article class="comment"><span class="comment-meta">@${escape(comment.author)} · ${escape(new Date(comment.createdAt).toLocaleString())}</span><p>${escape(comment.body)}</p></article>`).join("") || '<p class="empty">No comments yet</p>'}
        ${initial.editable && !isNew ? '<div class="field"><label for="new-comment">Add comment</label><textarea id="new-comment" name="newComment" placeholder="Leave useful context for the team"></textarea></div>' : ""}
      </section>
    </form>`;
    const actions = initial.editable ? '<button class="button" data-cancel>Cancel</button><button class="button primary" type="submit" form="ticket-form">Save ticket</button>' : "";
    const backdrop = modal(isNew ? `New ${ticket.id}` : ticket.id, content, actions);
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#ticket-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      ticket.title = String(data.get("title")).trim();
      ticket.description = String(data.get("description"));
      const previousColumn = ticket.columnId;
      ticket.columnId = String(data.get("columnId"));
      if (ticket.columnId !== previousColumn || isNew) ticket.rank = Math.max(0, ...Object.values(board.tickets).filter((item) => item.columnId === ticket.columnId).map((item) => item.rank)) + 1000;
      ticket.priority = String(data.get("priority"));
      ticket.storyPoints = data.get("storyPoints") === "" ? null : Number(data.get("storyPoints"));
      ticket.assignee = String(data.get("assignee")).trim() || null;
      ticket.sprintId = String(data.get("sprintId")) || null;
      ticket.labels = String(data.get("labels")).split(",").map((label) => label.trim().toLowerCase()).filter(Boolean);
      ticket.updatedAt = new Date().toISOString();
      const comment = String(data.get("newComment") ?? "").trim();
      if (comment) ticket.comments.push({ id: crypto.randomUUID(), author: initial.author, body: comment, createdAt: new Date().toISOString() });
      board.tickets[ticket.id] = ticket;
      if (isNew) board.project.nextTicketNumber += 1;
      for (const sprint of Object.values(board.sprints)) sprint.ticketIds = Object.values(board.tickets).filter((item) => item.sprintId === sprint.id).map((item) => item.id).sort();
      backdrop.remove(); render(); await save();
    });
    backdrop.querySelector("#title")?.focus();
  }

  function openSprints() {
    const content = `<div class="form"><div class="field full"><span class="meta-label">Sprint history</span>${Object.values(board.sprints).map((sprint) => `<div class="sprint-row"><div><strong>${escape(sprint.name)}</strong><span>${escape(sprint.state)} · ${sprint.ticketIds.length} tickets · ${escape(sprint.plannedStart ?? "No start")} → ${escape(sprint.plannedEnd ?? "No end")}</span></div><button class="button" data-edit-sprint="${escape(sprint.id)}">Edit</button></div>`).join("") || '<p class="empty">Create a sprint to group planned work.</p>'}</div></div>`;
    const backdrop = modal("Sprints", content, '<button class="button primary" id="new-sprint">New sprint</button>');
    backdrop.querySelector("#new-sprint").addEventListener("click", () => { backdrop.remove(); editSprint(); });
    backdrop.querySelectorAll("[data-edit-sprint]").forEach((button) => button.addEventListener("click", () => { backdrop.remove(); editSprint(button.dataset.editSprint); }));
  }

  function editSprint(id) {
    const isNew = !id;
    const sprint = isNew ? { id: `sprint-${Object.keys(board.sprints).length + 1}`, name: "", state: "planned", plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, ticketIds: [], metrics: null } : structuredClone(board.sprints[id]);
    const content = `<form class="form" id="sprint-form"><div class="field full"><label>Name</label><input name="name" required value="${escape(sprint.name)}"></div><div class="field"><label>State</label><select name="state">${["planned", "active", "completed"].map((value) => `<option ${sprint.state === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="field"><label>ID</label><input name="id" value="${escape(sprint.id)}" ${isNew ? "" : "disabled"}></div><div class="field"><label>Planned start</label><input name="plannedStart" type="date" value="${escape(sprint.plannedStart?.slice(0, 10) ?? "")}"></div><div class="field"><label>Planned end</label><input name="plannedEnd" type="date" value="${escape(sprint.plannedEnd?.slice(0, 10) ?? "")}"></div></form>`;
    const backdrop = modal(isNew ? "New sprint" : sprint.name, content, '<button class="button" data-cancel>Cancel</button><button class="button primary" type="submit" form="sprint-form">Save sprint</button>');
    backdrop.querySelector("[data-cancel]").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#sprint-form").addEventListener("submit", async (event) => {
      event.preventDefault(); const data = new FormData(event.target); const now = new Date().toISOString(); const previousState = sprint.state;
      sprint.id = String(data.get("id") ?? sprint.id).trim(); sprint.name = String(data.get("name")).trim(); sprint.state = String(data.get("state"));
      sprint.plannedStart = data.get("plannedStart") ? `${data.get("plannedStart")}T00:00:00.000Z` : null; sprint.plannedEnd = data.get("plannedEnd") ? `${data.get("plannedEnd")}T23:59:59.999Z` : null;
      if (sprint.state === "active" && previousState !== "active") sprint.actualStart = now;
      if (sprint.state === "completed" && previousState !== "completed") sprint.actualEnd = now;
      sprint.metrics = sprint.state === "completed" ? sprint.metrics ?? {} : null;
      board.sprints[sprint.id] = sprint; backdrop.remove(); render(); await save();
    });
  }

  function openMetrics() {
    const sprint = activeSprint() ?? Object.values(board.sprints).filter((item) => item.state === "completed").at(-1);
    if (!sprint) return void modal("Metrics", '<p class="notice">Create and start a sprint before requesting metrics.</p>');
    const metrics = sprint.metrics;
    const done = sprint.ticketIds.filter((id) => column(board.tickets[id]?.columnId)?.category === "done");
    const values = metrics ?? { velocity: done.reduce((sum, id) => sum + (board.tickets[id].storyPoints ?? 0), 0), throughput: done.length, averageLeadDays: null, averageCycleDays: null };
    modal(`${sprint.name} metrics`, `<div class="form"><div class="field full"><div class="metric-grid"><div class="metric"><strong>${values.velocity ?? 0}</strong><span>Velocity</span></div><div class="metric"><strong>${values.throughput ?? 0}</strong><span>Throughput</span></div><div class="metric"><strong>${values.averageLeadDays ?? "—"}</strong><span>Lead days</span></div><div class="metric"><strong>${values.averageCycleDays ?? "—"}</strong><span>Cycle days</span></div></div></div><p class="field full">Run <code>npm run board:metrics</code> for the Git-history report and burndown graph.</p></div>`);
  }

  try { render(); } catch (error) { root.innerHTML = `<section class="fatal"><h1>The board could not render</h1><pre>${escape(error.stack ?? error.message)}</pre></section>`; }
})();
