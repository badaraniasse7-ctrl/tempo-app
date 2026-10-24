(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const LOCAL_KEY = "tempo.productivity.v2";
  const CLOUD_CONFIG_KEY = "tempo.supabase.config.v1";

  const STATUSES = { open: "À faire", doing: "En cours", done: "Terminée" };
  const PRIORITIES = { low: "Basse", medium: "Moyenne", high: "Haute" };
  const COLORS = {
    purple: "#6858e8",
    blue: "#5280dc",
    green: "#1fa779",
    orange: "#c98232",
    pink: "#c45b8b"
  };

  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const nowISO = () => new Date().toISOString();
  const uid = () => crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

  const fmtDate = (value, options = { day: "numeric", month: "short" }) => {
    if (!value) return "Sans date";
    const d = new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? "Sans date"
      : new Intl.DateTimeFormat("fr-FR", options).format(d);
  };

  const shortDate = value =>
    value ? fmtDate(value, { day: "2-digit", month: "short" }) : "Sans échéance";

  const defaultState = () => ({
    version: 2,
    tasks: [],
    planning: [],
    projects: [],
    notes: []
  });

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return defaultState();

      const parsed = JSON.parse(raw);

      return {
        version: 2,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        planning: Array.isArray(parsed.planning) ? parsed.planning : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : []
      };
    } catch (e) {
      console.warn("Lecture locale impossible", e);
      return defaultState();
    }
  }

  let state = loadLocal();
  let activeView = "dashboard";
  let taskFilter = "all";
  let selectedNoteId = null;
  let noteSaveTimer = null;
  let toastTimer = null;
  let cloudClient = null;
  let cloudUser = null;
  let cloudEnabled = false;
  let remoteSaveTimer = null;
  let calendarMode = "week";
  let calendarCursor = new Date();

  calendarCursor.setHours(12, 0, 0, 0);

  let isApplyingRemote = false;
  let authListenerAttached = false;

  // ---------- Persistance ----------

  function persistLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
      $("#footerSaveState").textContent = cloudEnabled
        ? "Sauvegarde locale + cloud"
        : "Sauvegarde locale activée";
      return true;
    } catch (e) {
      showToast("La sauvegarde locale a échoué.");
      return false;
    }
  }

  function persist() {
    persistLocal();

    if (cloudEnabled && cloudClient && cloudUser && !isApplyingRemote) {
      clearTimeout(remoteSaveTimer);

      remoteSaveTimer = setTimeout(() => {
        saveRemote().catch(e => {
          console.error(e);
          $("#footerSaveState").textContent = "Erreur de synchronisation cloud";
          showToast("Sauvegarde cloud impossible. Données locales conservées.");
        });
      }, 650);
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setSyncStatus(online, title, description) {
    $("#syncDot").classList.toggle("online", !!online);
    $("#syncTitle").textContent = title;
    $("#syncDescription").textContent = description;
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el && !el.open) el.showModal();
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el?.open) el.close();
  }

  function goTo(view) {
    activeView = view;

    $$(".view").forEach(el =>
      el.classList.toggle("active", el.id === `view-${view}`)
    );

    $$(".nav-item[data-view]").forEach(el =>
      el.classList.toggle("active", el.dataset.view === view)
    );

    const names = {
      dashboard: "Tableau de bord",
      tasks: "Mes tâches",
      calendar: "Planning",
      projects: "Mes projets",
      notes: "Bloc-notes"
    };

    $("#currentSection").textContent = names[view] || "Mon espace";
    $("#sidebar").classList.remove("open");
    $("#overlay").classList.remove("show");
    renderAll();
  }

  const projectById = id => state.projects.find(p => p.id === id);
  const taskById = id => state.tasks.find(t => t.id === id);
  const planningById = id => state.planning.find(p => p.id === id);

  function taskProgress(projectId) {
    const tasks = state.tasks.filter(t => t.projectId === projectId);

    return {
      total: tasks.length,
      done: tasks.filter(t => t.status === "done").length
    };
  }

  function progressPercent(projectId) {
    const p = taskProgress(projectId);
    return p.total ? Math.round(p.done / p.total * 100) : 0;
  }

  // ============================================================
  // TABLEAU DE BORD
  // ============================================================

  function renderDashboard() {
    const today = todayISO();

    $("#todayDate").textContent = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date());

    const openTasks = state.tasks.filter(t => t.status !== "done");
    const overdue = openTasks.filter(t => t.dueDate && t.dueDate < today);
    const activeProjects = state.projects.filter(p => p.status === "active");
    const done = state.tasks.filter(t => t.status === "done").length;
    const total = state.tasks.length;
    const percent = total ? Math.round(done / total * 100) : 0;

    $("#todayTasksStat").textContent = openTasks.length;
    $("#overdueStat").textContent = overdue.length;
    $("#activeProjectsStat").textContent = activeProjects.length;
    $("#completionStat").textContent = `${percent}%`;
    $("#completionBar").style.width = `${percent}%`;
    $("#focusPercent").textContent = `${percent}%`;

    $("#focusRing").style.background =
      `conic-gradient(var(--purple) ${percent * 3.6}deg,#eeeef5 0deg)`;

    $("#focusDone").textContent = done;
    $("#focusRemaining").textContent = total - done;

    $("#focusCaption").textContent = total
      ? (percent === 100
        ? "Bravo, toutes tes tâches sont terminées !"
        : "Chaque tâche terminée est une avancée.")
      : "Ajoute une tâche pour commencer.";

    $("#navTaskCount").textContent = openTasks.length;

    // Tâches récentes : tri tolérant aux tâches sans échéance.
    const upcoming = [...openTasks]
      .sort((a, b) => {
        const da = a.dueDate || "9999-99-99";
        const db = b.dueDate || "9999-99-99";
        return da.localeCompare(db);
      })
      .slice(0, 5);

    $("#dashboardTasks").innerHTML = upcoming.map(t => {
      const metaParts = [];

      if (t.projectId) metaParts.push(projectById(t.projectId)?.name);
      if (t.dueDate) metaParts.push(shortDate(t.dueDate));

      if (metaParts.length === 0) {
        metaParts.push("Sans projet · Sans échéance");
      }

      return `
        <div class="compact-task">
          <input
            class="task-check"
            type="checkbox"
            data-complete-task="${esc(t.id)}"
            aria-label="Terminer ${esc(t.title)}"
          >
          <div class="compact-task-main">
            <div class="compact-task-title">${esc(t.title)}</div>
            <div class="compact-task-meta">${esc(metaParts.join(" · "))}</div>
          </div>
          <span class="priority-dot priority-${esc(t.priority || "medium")}"></span>
        </div>`;
    }).join("");

    $("#dashboardTasksEmpty").hidden = upcoming.length > 0;

    // Planning à venir.
    const nowStr = nowISO().slice(0, 16);

    const upcomingPlanning = [...state.planning]
      .filter(p => `${p.date}T${p.startTime}` >= nowStr)
      .sort((a, b) =>
        `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
      )
      .slice(0, 5);

    $("#dashboardPlanning").innerHTML = upcomingPlanning.map(p => `
      <div class="compact-task">
        <div class="compact-task-main">
          <div class="compact-task-title">${esc(p.title)}</div>
          <div class="compact-task-meta">
            ${esc(fmtDate(p.date, {
              weekday: "short",
              day: "numeric",
              month: "short"
            }))} · ${esc(p.startTime)}
          </div>
        </div>
      </div>
    `).join("");

    $("#dashboardPlanningEmpty").hidden = upcomingPlanning.length > 0;

    // Projets.
    $("#dashboardProjects").innerHTML = activeProjects.slice(0, 4).map(p => {
      const prog = progressPercent(p.id);
      const stats = taskProgress(p.id);

      return `
        <div class="project-row">
          <div class="project-row-top">
            <div>
              <div class="project-name">${esc(p.name)}</div>
              <div class="project-meta">
                ${stats.done}/${stats.total} tâches terminées
              </div>
            </div>
            <strong>${prog}%</strong>
          </div>
          <div class="project-progress">
            <span style="width:${prog}%;--project-color:${COLORS[p.color] || COLORS.purple}"></span>
          </div>
        </div>`;
    }).join("");

    $("#dashboardProjectsEmpty").hidden = activeProjects.length > 0;

    // Notes récentes.
    const notes = [...state.notes]
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 3);

    $("#dashboardNotes").innerHTML = notes.map(n => `
      <button class="notes-preview" data-open-note="${esc(n.id)}">
        <strong>${esc(n.title || "Note sans titre")}</strong>
        <p>${esc(n.content || "Note vide")}</p>
      </button>
    `).join("");

    $("#dashboardNotesEmpty").hidden = notes.length > 0;
  }
    // ============================================================
  // TÂCHES
  // ============================================================

  function renderProjectSelects() {
    const options = state.projects
      .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join("");

    const currentFilter = $("#taskProjectFilter").value || "all";

    $("#taskProjectFilter").innerHTML =
      `<option value="all">Tous les projets</option>${options}`;

    if ([...$("#taskProjectFilter").options].some(o => o.value === currentFilter)) {
      $("#taskProjectFilter").value = currentFilter;
    }

    const currentTask = $("#taskProject").value;

    $("#taskProject").innerHTML =
      `<option value="">Sans projet</option>${options}`;

    if ([...$("#taskProject").options].some(o => o.value === currentTask)) {
      $("#taskProject").value = currentTask;
    }
  }

  function taskRow(t) {
    const project = projectById(t.projectId);
    const overdue = t.status !== "done" && t.dueDate && t.dueDate < todayISO();
    const priority = t.priority || "medium";
    const status = t.status || "open";
    const hasMeta = project || t.dueDate || t.createdAt;

    return `
      <div class="task-row ${status === "done" ? "task-row-done" : ""}">
        <div class="task-row-main">
          <div class="task-row-heading">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <input
                class="task-check"
                type="checkbox"
                data-complete-task="${esc(t.id)}"
                ${status === "done" ? "checked" : ""}
                aria-label="Terminer ${esc(t.title)}"
              >
              <strong class="${status === "done" ? "done" : ""}">
                ${esc(t.title)}
              </strong>
            </div>

            <div class="task-meta">
              <span class="priority-badge ${esc(priority)}">
                ${esc(PRIORITIES[priority] || "Moyenne")}
              </span>
              <span class="status-badge ${esc(status)}">
                ${esc(STATUSES[status] || "À faire")}
              </span>
            </div>
          </div>

          ${t.description
            ? `<p class="task-row-description">${esc(t.description)}</p>`
            : ""}

          ${hasMeta ? `
            <div class="task-meta">
              ${project
                ? `<span class="created-label">Projet : ${esc(project.name)}</span>`
                : ""}

              ${t.createdAt
                ? `<span class="created-label">Créée le ${esc(fmtDate(t.createdAt.slice(0, 10)))}</span>`
                : ""}

              ${t.dueDate
                ? `<span class="created-label ${overdue ? "overdue" : ""}">
                    ${overdue ? "En retard · " : ""}${esc(shortDate(t.dueDate))}
                  </span>`
                : ""}
            </div>
          ` : ""}
        </div>

        <div class="task-row-actions">
          <button class="tiny-button" data-edit-task="${esc(t.id)}" aria-label="Modifier">✎</button>
          <button class="tiny-button" data-delete-task="${esc(t.id)}" aria-label="Supprimer">×</button>
        </div>
      </div>`;
  }

  function renderTasks() {
    const projectFilter = $("#taskProjectFilter").value || "all";
    const search = $("#globalSearch").value.trim().toLowerCase();

    let tasks = state.tasks.filter(t => {
      const matchesFilter = taskFilter === "all" || t.status === taskFilter;
      const matchesProject = projectFilter === "all" || t.projectId === projectFilter;
      const matchesSearch = !search ||
        `${t.title} ${t.description || ""}`.toLowerCase().includes(search);

      return matchesFilter && matchesProject && matchesSearch;
    });

    const sort = $("#taskSort").value;

    tasks.sort((a, b) => {
      if (sort === "priority") {
        return ({ high: 0, medium: 1, low: 2 }[a.priority] -
                { high: 0, medium: 1, low: 2 }[b.priority]);
      }

      if (sort === "created") {
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      }

      if (sort === "due") {
        return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      }

      return 0;
    });

    $("#taskList").innerHTML = tasks.map(taskRow).join("");
    $("#tasksEmpty").hidden = tasks.length > 0;
  }

  // ============================================================
  // PLANNING
  // ============================================================

  function dateAdd(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfWeek(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;

    d.setDate(d.getDate() - day);
    d.setHours(12, 0, 0, 0);

    return d;
  }

  function dateKey(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function planningForDate(key) {
    return state.planning
      .filter(p => p.date === key)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  }

  // Chaque événement du calendrier possède un bouton de suppression.
  function planningEventHTML(p) {
    return `
      <div class="calendar-event-row"
           style="display:flex;align-items:center;gap:3px;min-width:0">

        <button
          class="calendar-event"
          style="flex:1;min-width:0"
          data-edit-planning="${esc(p.id)}"
          title="${esc(p.title)} · ${esc(p.startTime)}">
          ${esc(p.startTime)} · ${esc(p.title)}
        </button>

        <button
          type="button"
          class="tiny-button"
          style="flex:0 0 auto;padding:0 5px;color:#dc2626"
          data-delete-planning="${esc(p.id)}"
          aria-label="Supprimer ${esc(p.title)}"
          title="Supprimer cet événement">
          ×
        </button>
      </div>`;
  }

  function renderCalendar() {
    const title = $("#calendarTitle");
    const content = $("#calendarContent");

    if (calendarMode === "day") {
      const key = dateKey(calendarCursor);

      title.textContent = fmtDate(key, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });

      const items = planningForDate(key);

      content.innerHTML = items.length
        ? `<div class="day-agenda">
            ${items.map(p => `
              <div class="agenda-item">
                <div class="agenda-time">${esc(p.startTime)}</div>

                <div>
                  <strong>${esc(p.title)}</strong>
                  <p>${esc(p.description || "")}</p>
                </div>

                <div class="agenda-actions">
                  <button class="tiny-button" data-edit-planning="${esc(p.id)}">✎</button>
                  <button class="tiny-button" data-delete-planning="${esc(p.id)}">×</button>
                </div>
              </div>
            `).join("")}
          </div>`
        : `<div class="empty-state">
            <span class="empty-emoji">◷</span>
            <h3>Rien de planifié ce jour</h3>
            <p>Ajoute un événement avec une date et une heure de début.</p>
            <button class="primary-button" data-action="new-planning">
              ＋ Nouvel événement
            </button>
          </div>`;

      return;
    }

    if (calendarMode === "week") {
      const start = startOfWeek(calendarCursor);
      const end = dateAdd(start, 6);

      title.textContent =
        `${fmtDate(dateKey(start), { day: "numeric", month: "short" })} – ` +
        `${fmtDate(dateKey(end), { day: "numeric", month: "short", year: "numeric" })}`;

      const days = Array.from({ length: 7 }, (_, i) => dateAdd(start, i));

      content.innerHTML = `
        <div class="calendar-grid">
          ${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
            .map(d => `<div class="calendar-cell calendar-weekday">${d}</div>`)
            .join("")}

          ${days.map(d => {
            const key = dateKey(d);
            const items = planningForDate(key);

            return `
              <div class="calendar-cell ${key === todayISO() ? "today" : ""}">
                <div class="calendar-day-number">${d.getDate()}</div>
                ${items.slice(0, 4).map(planningEventHTML).join("")}
                ${items.length > 4 ? `<small>+${items.length - 4} autres</small>` : ""}
              </div>`;
          }).join("")}
        </div>`;

      return;
    }

    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();

    title.textContent = new Intl.DateTimeFormat("fr-FR", {
      month: "long",
      year: "numeric"
    }).format(calendarCursor);

    const first = new Date(year, month, 1, 12);
    const start = startOfWeek(first);
    const days = Array.from({ length: 42 }, (_, i) => dateAdd(start, i));

    content.innerHTML = `
      <div class="calendar-grid">
        ${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
          .map(d => `<div class="calendar-cell calendar-weekday">${d}</div>`)
          .join("")}

        ${days.map(d => {
          const key = dateKey(d);
          const items = planningForDate(key);

          return `
            <div class="calendar-cell
              ${d.getMonth() !== month ? "other-month" : ""}
              ${key === todayISO() ? "today" : ""}">

              <div class="calendar-day-number">${d.getDate()}</div>
              ${items.slice(0, 3).map(planningEventHTML).join("")}
            </div>`;
        }).join("")}
      </div>`;
  }
    // ============================================================
  // PROJETS
  // ============================================================

  function renderProjects() {
    const search = $("#projectSearch").value.trim().toLowerCase();
    const filter = $("#projectStatusFilter").value;

    const projects = state.projects.filter(p =>
      (filter === "all" || p.status === filter) &&
      (!search ||
        `${p.name} ${p.description || ""} ${p.category || ""}`
          .toLowerCase()
          .includes(search))
    );

    $("#projectGrid").innerHTML = projects.map(p => {
      const stats = taskProgress(p.id);
      const prog = stats.total
        ? Math.round(stats.done / stats.total * 100)
        : 0;

      const projectNotes = state.notes.filter(n => n.projectId === p.id).length;

      return `
        <article class="project-card">
          <div class="project-card-top">
            <div class="project-color ${esc(p.color)}">▤</div>
            <span class="status-badge ${
              p.status === "done" ? "done" :
              p.status === "paused" ? "open" : "doing"
            }">
              ${
                p.status === "active" ? "En cours" :
                p.status === "paused" ? "En pause" : "Terminé"
              }
            </span>
          </div>

          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description || p.category || "Un espace pour organiser ce projet.")}</p>

          <div class="project-meta-line">
            <span>${stats.done}/${stats.total} tâches</span>
            <span>${prog}%</span>
          </div>

          <div class="project-progress">
            <span style="width:${prog}%;--project-color:${COLORS[p.color] || COLORS.purple}"></span>
          </div>

          <div class="project-card-bottom">
            <span>
              ${p.dueDate
                ? "Échéance " + esc(shortDate(p.dueDate))
                : "Sans échéance"}
            </span>

            <div style="display:flex;align-items:center;gap:8px">
              <button class="text-button" data-edit-project="${esc(p.id)}">
                Modifier →
              </button>

              <button
                type="button"
                class="tiny-button"
                style="color:#dc2626"
                data-delete-project="${esc(p.id)}"
                aria-label="Supprimer le projet ${esc(p.name)}"
                title="Supprimer ce projet">
                ×
              </button>
            </div>
          </div>

          <div class="project-notebook-row">
            <button class="secondary-button" data-project-notes="${esc(p.id)}">
              ▧ Notes du projet (${projectNotes})
            </button>
          </div>
        </article>`;
    }).join("");

    $("#projectsEmpty").hidden = projects.length > 0;
  }

  // ============================================================
  // NOTES
  // ============================================================

  function renderNotes() {
    const search = $("#noteSearch").value.trim().toLowerCase();

    const notes = [...state.notes]
      .filter(n =>
        !search ||
        `${n.title} ${n.content}`.toLowerCase().includes(search)
      )
      .sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || "")
      );

    $("#noteList").innerHTML = notes.map(n => `
      <button
        class="note-list-item ${n.id === selectedNoteId ? "selected" : ""}"
        data-select-note="${esc(n.id)}">

        <strong>${esc(n.title || "Note sans titre")}</strong>
        <p>${esc(n.content || "Note vide")}</p>
        <span>${esc(fmtDate((n.updatedAt || nowISO()).slice(0, 10)))}</span>
      </button>
    `).join("");

    $("#notesListEmpty").hidden = notes.length > 0;

    const note = state.notes.find(n => n.id === selectedNoteId);
    const editor = $("#noteEditor");

    if (!note) {
      editor.innerHTML = `
        <div class="note-editor-empty">
          <span>▧</span>
          <h3>Ton espace d'idées</h3>
          <p>Crée une note pour commencer à écrire.</p>
          <button class="primary-button" data-action="new-note">
            ＋ Nouvelle note
          </button>
        </div>`;
      return;
    }

    editor.innerHTML = `
      <div class="note-edit-head">
        <span class="note-autosave" id="noteSaveStatus">● Enregistré</span>
        <button class="tiny-button" data-delete-note="${esc(note.id)}">
          Supprimer ×
        </button>
      </div>

      <input
        class="note-title-input"
        id="editNoteTitle"
        maxlength="160"
        aria-label="Titre"
        placeholder="Titre de la note"
        value="${esc(note.title)}">

      <div class="note-meta-row">
        <span class="note-autosave">
          Sauvegarde automatique + bouton Enregistrer
        </span>
      </div>

      <textarea
        class="note-content-input"
        id="editNoteContent"
        aria-label="Contenu"
        placeholder="Écris librement...">${esc(note.content)}</textarea>

      <div class="note-actions">
        <span>
          Dernière modification :
          ${esc(fmtDate((note.updatedAt || nowISO()).slice(0, 10), {
            day: "numeric",
            month: "long",
            year: "numeric"
          }))}
        </span>

        <div>
          <button class="secondary-button" id="saveNoteBtn">
            💾 Enregistrer
          </button>
          <button class="primary-button" data-note-to-task="${esc(note.id)}">
            Créer une tâche
          </button>
        </div>
      </div>`;
  }

  function renderNoteListOnly() {
    const search = $("#noteSearch").value.trim().toLowerCase();

    const notes = [...state.notes]
      .filter(n =>
        !search ||
        `${n.title} ${n.content}`.toLowerCase().includes(search)
      )
      .sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || "")
      );

    $("#noteList").innerHTML = notes.map(n => `
      <button
        class="note-list-item ${n.id === selectedNoteId ? "selected" : ""}"
        data-select-note="${esc(n.id)}">
        <strong>${esc(n.title || "Note sans titre")}</strong>
        <p>${esc(n.content || "Note vide")}</p>
        <span>${esc(fmtDate((n.updatedAt || nowISO()).slice(0, 10)))}</span>
      </button>
    `).join("");

    $("#notesListEmpty").hidden = notes.length > 0;
  }

  function openNoteModal(note = null) {
    $("#noteForm").reset();
    $("#noteId").value = note?.id || "";
    $("#noteModalTitle").textContent = note ? "Modifier la note" : "Nouvelle note";
    $("#noteTitle").value = note?.title || "";
    $("#noteContent").value = note?.content || "";

    openModal("noteModal");
    setTimeout(() => $("#noteTitle").focus(), 50);
  }

  function saveNoteFromModal(event) {
    event.preventDefault();

    const id = $("#noteId").value || uid();
    const previous = state.notes.find(n => n.id === id);

    const note = {
      id,
      title: $("#noteTitle").value.trim(),
      content: $("#noteContent").value.trim(),
      projectId: previous?.projectId || null,
      isProjectNote: previous?.isProjectNote || false,
      createdAt: previous?.createdAt || nowISO(),
      updatedAt: nowISO()
    };

    const index = state.notes.findIndex(n => n.id === id);

    if (index >= 0) {
      state.notes[index] = note;
    } else {
      state.notes.unshift(note);
    }

    selectedNoteId = id;
    persist();
    closeModal("noteModal");
    goTo("notes");
    renderAll();

    showToast(previous ? "Note mise à jour." : "Note enregistrée.");
  }

  function saveCurrentNote() {
    const note = state.notes.find(n => n.id === selectedNoteId);
    if (!note) return;

    note.title = $("#editNoteTitle")?.value || "";
    note.content = $("#editNoteContent")?.value || "";
    note.updatedAt = nowISO();

    persist();
    renderNoteListOnly();

    const s = $("#noteSaveStatus");
    if (s) s.textContent = "● Enregistré";

    showToast("Note enregistrée.");
  }

  function scheduleNoteSave() {
    const note = state.notes.find(n => n.id === selectedNoteId);
    if (!note) return;

    note.title = $("#editNoteTitle")?.value || "";
    note.content = $("#editNoteContent")?.value || "";
    note.updatedAt = nowISO();

    const status = $("#noteSaveStatus");
    if (status) status.textContent = "● Enregistrement...";

    clearTimeout(noteSaveTimer);

    noteSaveTimer = setTimeout(() => {
      persist();
      renderNoteListOnly();

      const s = $("#noteSaveStatus");
      if (s) {
        s.textContent = cloudEnabled
          ? "● Sauvegardé (cloud en attente)"
          : "● Enregistré";
      }
    }, 450);
  }

  function deleteNote(id) {
    if (!confirm("Supprimer définitivement cette note ?")) return;

    state.notes = state.notes.filter(n => n.id !== id);

    if (selectedNoteId === id) selectedNoteId = null;

    persist();
    renderAll();
    showToast("Note supprimée.");
  }

  function renderAll() {
    renderProjectSelects();
    renderDashboard();
    renderTasks();
    renderCalendar();
    renderProjects();
    renderNotes();
  }

  // ============================================================
  // MODAUX : TÂCHE / PLANNING / PROJET
  // ============================================================

  function openTaskModal(task = null, defaults = {}) {
    $("#taskForm").reset();
    $("#taskId").value = task?.id || "";
    $("#taskModalTitle").textContent = task ? "Modifier la tâche" : "Nouvelle tâche";
    $("#taskTitle").value = task?.title || "";
    $("#taskDescription").value = task?.description || "";
    $("#taskProject").value = task?.projectId || defaults.projectId || "";
    $("#taskStatus").value = task?.status || "open";
    $("#taskPriority").value = task?.priority || "medium";
    $("#taskDue").value = task?.dueDate || defaults.dueDate || "";

    const details = $("#taskForm details.task-optional");

    if (details) {
      const hasOptions = !!(
        task?.description ||
        task?.projectId ||
        task?.dueDate ||
        defaults.projectId ||
        defaults.dueDate ||
        task?.status === "doing" ||
        task?.status === "done" ||
        task?.priority === "high" ||
        task?.priority === "low"
      );

      details.open = hasOptions;
    }

    openModal("taskModal");
    setTimeout(() => $("#taskTitle").focus(), 50);
  }

  function saveTask(event) {
    event.preventDefault();

    const title = $("#taskTitle").value.trim();

    if (!title) {
      showToast("Le titre est obligatoire.");
      return;
    }

    const id = $("#taskId").value || uid();
    const previous = taskById(id);

    const task = {
      id,
      title,
      description: ($("#taskDescription").value || "").trim(),
      projectId: $("#taskProject").value || null,
      status: $("#taskStatus").value || "open",
      priority: $("#taskPriority").value || "medium",
      dueDate: $("#taskDue").value || null,
      createdAt: previous?.createdAt || nowISO(),
      updatedAt: nowISO()
    };

    const index = state.tasks.findIndex(t => t.id === id);

    if (index >= 0) {
      state.tasks[index] = task;
    } else {
      state.tasks.push(task);
    }

    persist();
    closeModal("taskModal");
    renderAll();

    showToast(previous ? "Tâche mise à jour." : "Tâche ajoutée.");
  }

  function deleteTask(id) {
    if (!confirm("Supprimer cette tâche ?")) return;

    state.tasks = state.tasks.filter(t => t.id !== id);

    persist();
    renderAll();
    showToast("Tâche supprimée.");
  }

  function toggleTaskDone(id, checked) {
    const task = taskById(id);
    if (!task) return;

    task.status = checked ? "done" : "open";
    task.updatedAt = nowISO();

    persist();
    renderAll();

    showToast(checked ? "Tâche terminée !" : "Tâche rouverte.");
  }

  function openPlanningModal(planning = null, defaults = {}) {
    $("#planningForm").reset();
    $("#planningId").value = planning?.id || "";
    $("#planningModalTitle").textContent =
      planning ? "Modifier l'événement" : "Nouvel événement";

    $("#planningTitle").value = planning?.title || "";
    $("#planningDescription").value = planning?.description || "";
    $("#planningDate").value =
      planning?.date || defaults.date || dateKey(calendarCursor);
    $("#planningStartTime").value =
      planning?.startTime || defaults.startTime || "";

    openModal("planningModal");
    setTimeout(() => $("#planningTitle").focus(), 50);
  }

  function savePlanning(event) {
    event.preventDefault();

    const id = $("#planningId").value || uid();
    const previous = planningById(id);

    const planning = {
      id,
      title: $("#planningTitle").value.trim(),
      description: $("#planningDescription").value.trim(),
      date: $("#planningDate").value,
      startTime: $("#planningStartTime").value,
      createdAt: previous?.createdAt || nowISO(),
      updatedAt: nowISO()
    };

    const index = state.planning.findIndex(p => p.id === id);

    if (index >= 0) {
      state.planning[index] = planning;
    } else {
      state.planning.push(planning);
    }

    persist();
    closeModal("planningModal");
    renderAll();

    showToast(previous ? "Événement mis à jour." : "Événement ajouté.");
  }

  // Supprimer un projet.
  function deleteProject(id) {
    const project = state.projects.find(
      item => String(item.id) === String(id)
    );

    if (!project) {
      showToast("Projet introuvable.");
      return;
    }

    const confirmed = confirm(
      `Supprimer le projet « ${project.name} » ? Cette action est irréversible.`
    );

    if (!confirmed) return;

    state.projects = state.projects.filter(
      item => String(item.id) !== String(id)
    );

    persist();
    renderAll();

    showToast("Projet supprimé avec succès.");
  }

  // Supprimer un élément du planning.
  function deletePlanning(id) {
    const planningItem = state.planning.find(
      item => String(item.id) === String(id)
    );

    if (!planningItem) {
      showToast("Élément du planning introuvable.");
      return;
    }

    const confirmed = confirm(
      `Supprimer « ${planningItem.title} » du planning ?`
    );

    if (!confirmed) return;

    state.planning = state.planning.filter(
      item => String(item.id) !== String(id)
    );

    persist();
    renderAll();

    showToast("Élément supprimé du planning.");
  }

  function openProjectModal(project = null) {
    $("#projectForm").reset();
    $("#projectId").value = project?.id || "";
    $("#projectModalTitle").textContent =
      project ? "Modifier le projet" : "Nouveau projet";

    $("#projectName").value = project?.name || "";
    $("#projectDescription").value = project?.description || "";
    $("#projectCategory").value = project?.category || "";
    $("#projectColor").value = project?.color || "purple";
    $("#projectStart").value = project?.startDate || "";
    $("#projectDue").value = project?.dueDate || "";
    $("#projectStatus").value = project?.status || "active";

    const linked = state.notes.find(
      n => n.projectId === project?.id && n.isProjectNote
    );

    $("#projectNotes").value = linked?.content || "";

    openModal("projectModal");
    setTimeout(() => $("#projectName").focus(), 50);
  }

  function saveProject(event) {
    event.preventDefault();

    const id = $("#projectId").value || uid();
    const previous = projectById(id);

    const project = {
      id,
      name: $("#projectName").value.trim(),
      description: $("#projectDescription").value.trim(),
      category: $("#projectCategory").value.trim(),
      color: $("#projectColor").value,
      status: $("#projectStatus").value,
      startDate: $("#projectStart").value || null,
      dueDate: $("#projectDue").value || null,
      createdAt: previous?.createdAt || nowISO(),
      updatedAt: nowISO()
    };

    if (
      project.startDate &&
      project.dueDate &&
      project.dueDate < project.startDate
    ) {
      showToast("L'échéance ne peut pas précéder la date de début.");
      return;
    }

    const index = state.projects.findIndex(p => p.id === id);

    if (index >= 0) {
      state.projects[index] = project;
    } else {
      state.projects.push(project);
    }

    const notesContent = $("#projectNotes").value.trim();

    let linked = state.notes.find(
      n => n.projectId === id && n.isProjectNote
    );

    if (notesContent) {
      if (linked) {
        linked.content = notesContent;
        linked.updatedAt = nowISO();
        linked.title = `Notes — ${project.name}`;
      } else {
        state.notes.push({
          id: uid(),
          title: `Notes — ${project.name}`,
          content: notesContent,
          projectId: id,
          isProjectNote: true,
          createdAt: nowISO(),
          updatedAt: nowISO()
        });
      }
    } else if (linked) {
      state.notes = state.notes.filter(n => n.id !== linked.id);
    }

    persist();
    closeModal("projectModal");
    renderAll();

    showToast(previous ? "Projet mis à jour." : "Projet créé.");
  }

  function openProjectNotebook(projectId) {
    const linked = state.notes.find(
      n => n.projectId === projectId && n.isProjectNote
    );

    if (linked) {
      selectedNoteId = linked.id;
      goTo("notes");
    } else {
      goTo("notes");
      showToast("Ce projet n'a pas encore de note. Utilise « Modifier » pour en ajouter.");
    }
  }

  function noteToTask(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;

    openTaskModal(null, {});
    $("#taskTitle").value = note.title;
    $("#taskDescription").value = note.content;
  }

  function globalSearch() {
    const q = $("#globalSearch").value.trim().toLowerCase();

    if (!q) {
      renderAll();
      return;
    }

    const taskMatches = state.tasks.filter(t =>
      `${t.title} ${t.description || ""}`.toLowerCase().includes(q)
    );

    const planningMatches = state.planning.filter(p =>
      `${p.title} ${p.description || ""}`.toLowerCase().includes(q)
    );

    const projectMatches = state.projects.filter(p =>
      `${p.name} ${p.description || ""} ${p.category || ""}`
        .toLowerCase()
        .includes(q)
    );

    const noteMatches = state.notes.filter(n =>
      `${n.title} ${n.content}`.toLowerCase().includes(q)
    );

    if (
      taskMatches.length +
      planningMatches.length +
      projectMatches.length +
      noteMatches.length === 0
    ) {
      showToast("Aucun résultat trouvé.");
      return;
    }

    if (taskMatches.length) {
      taskFilter = "all";

      const b = $("#taskFilters [data-filter='all']");

      if (b) {
        $$("[data-filter]", $("#taskFilters"))
          .forEach(x => x.classList.toggle("selected", x === b));

        $("#taskProjectFilter").value = "all";
      }

      goTo("tasks");
    } else if (planningMatches.length) {
      goTo("calendar");
    } else if (projectMatches.length) {
      $("#projectSearch").value = q;
      goTo("projects");
    } else {
      $("#noteSearch").value = q;
      goTo("notes");
    }

    renderAll();

    showToast(
      `${taskMatches.length} tâche(s), ` +
      `${planningMatches.length} événement(s), ` +
      `${projectMatches.length} projet(s), ` +
      `${noteMatches.length} note(s).`
    );
  }

  // ============================================================
  // CLOUD : SUPABASE
  // ============================================================

  function readCloudConfig() {
    try {
      return JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCloudConfig(config) {
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
  }

  function attachAuthListener() {
    if (authListenerAttached || !cloudClient) return;

    authListenerAttached = true;

    cloudClient.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession?.user) {
        cloudUser = newSession.user;
        cloudEnabled = true;

        setSyncStatus(
          true,
          "Cloud connecté",
          cloudUser.email || "Compte synchronisé"
        );

        $("#footerSaveState").textContent = "Sauvegarde locale + cloud";
      } else {
        cloudUser = null;
        cloudEnabled = false;

        setSyncStatus(false, "Mode local", "Déconnecté du cloud");
        $("#footerSaveState").textContent = "Sauvegarde locale activée";
      }
    });
  }

  async function initCloud() {
    const config = readCloudConfig();

    if (!config.url || !config.key) {
      setSyncStatus(false, "Mode local", "Données sur cet appareil");
      return;
    }

    if (!window.supabase?.createClient) {
      setSyncStatus(
        false,
        "Cloud indisponible",
        "Le script Supabase n'a pas pu être chargé"
      );
      return;
    }

    try {
      cloudClient = window.supabase.createClient(config.url, config.key);
      attachAuthListener();

      const { data: { session }, error } =
        await cloudClient.auth.getSession();

      if (error) throw error;

      if (session) {
        cloudUser = session.user;
        await loadRemote();
        cloudEnabled = true;

        setSyncStatus(
          true,
          "Cloud connecté",
          cloudUser.email || "Compte synchronisé"
        );

        $("#footerSaveState").textContent = "Sauvegarde locale + cloud";
      } else {
        setSyncStatus(false, "Cloud configuré", "Connecte-toi pour synchroniser");
      }
    } catch (e) {
      console.error(e);
      setSyncStatus(false, "Cloud indisponible", "Vérifie la configuration");
    }
  }

  async function cloudAuth(signUp) {
    const url = $("#supabaseUrl").value.trim();
    const key = $("#supabaseKey").value.trim();
    const email = $("#cloudEmail").value.trim();
    const password = $("#cloudPassword").value;
    const status = $("#cloudStatus");

    if (!url || !key || !email || !password) {
      status.textContent =
        "Renseigne l'URL, la clé publique, l'e-mail et le mot de passe.";
      return;
    }

    if (!/^https:\/\/.+/.test(url)) {
      status.textContent = "L'URL doit commencer par https://";
      return;
    }

    if (!window.supabase?.createClient) {
      status.textContent = "Le SDK Supabase n'est pas chargé.";
      return;
    }

    saveCloudConfig({ url, key });

    try {
      cloudClient = window.supabase.createClient(url, key);
      attachAuthListener();

      status.textContent = signUp ? "Création du compte..." : "Connexion...";

      let result;

      if (signUp) {
        result = await cloudClient.auth.signUp({ email, password });
      } else {
        result = await cloudClient.auth.signInWithPassword({ email, password });
      }

      if (result.error) throw result.error;

      if (signUp && !result.data.session) {
        status.textContent =
          "Compte créé. Vérifie ta boîte e-mail si la confirmation est activée, puis connecte-toi.";

        setSyncStatus(
          false,
          "Vérifie ton e-mail",
          "Confirmation du compte nécessaire"
        );

        return;
      }

      cloudUser = result.data.user;
      cloudEnabled = !!result.data.session;

      if (cloudEnabled) {
        await loadRemote();

        setSyncStatus(
          true,
          "Cloud connecté",
          cloudUser.email || "Compte synchronisé"
        );

        $("#footerSaveState").textContent = "Sauvegarde locale + cloud";
        status.textContent = "Connexion réussie.";

        renderAll();
      } else {
        status.textContent =
          "Compte créé. Connecte-toi pour démarrer la synchronisation.";
      }
    } catch (e) {
      console.error(e);
      status.textContent =
        `Connexion impossible : ${e.message || "vérifie les paramètres et le script SQL"}`;
      cloudEnabled = false;
    }
  }

  async function loadRemote() {
    if (!cloudClient || !cloudUser) return;

    isApplyingRemote = true;

    try {
      const tables = ["projects", "tasks", "planning", "notes"];

      const result = await Promise.all(
        tables.map(table =>
          cloudClient
            .from(table)
            .select("id, data")
            .eq("user_id", cloudUser.id)
        )
      );

      for (const response of result) {
        if (response.error) throw response.error;
      }

      const [projects, tasks, planning, notes] =
        result.map(response => response.data || []);

      state.projects = projects.map(row => row.data);
      state.tasks = tasks.map(row => row.data);
      state.planning = planning.map(row => row.data);
      state.notes = notes.map(row => row.data);

      persistLocal();
    } finally {
      isApplyingRemote = false;
    }
  }

  async function saveRemote() {
    if (!cloudClient || !cloudUser || isApplyingRemote) return;

    const tables = [
      ["projects", state.projects],
      ["tasks", state.tasks],
      ["planning", state.planning],
      ["notes", state.notes]
    ];

    for (const [table, rows] of tables) {
      const ids = rows.map(r => r.id);

      if (rows.length) {
        const payload = rows.map(row => ({
          user_id: cloudUser.id,
          id: row.id,
          data: row
        }));

        const { error } = await cloudClient
          .from(table)
          .upsert(payload, { onConflict: "user_id,id" });

        if (error) throw error;
      }

      const {
        data: remoteRows,
        error: selectError
      } = await cloudClient
        .from(table)
        .select("id")
        .eq("user_id", cloudUser.id);

      if (selectError) throw selectError;

      const remoteIds = (remoteRows || [])
        .map(r => r.id)
        .filter(id => !ids.includes(id));

      if (remoteIds.length) {
        const { error: deleteError } = await cloudClient
          .from(table)
          .delete()
          .eq("user_id", cloudUser.id)
          .in("id", remoteIds);

        if (deleteError) throw deleteError;
      }
    }

    $("#footerSaveState").textContent = "Synchronisé avec le cloud";
  }

  // ============================================================
  // ÉVÉNEMENTS ET INTERACTIONS
  // ============================================================

  $$(".nav-item[data-view]").forEach(btn =>
    btn.addEventListener("click", () => goTo(btn.dataset.view))
  );

  $$("[data-goto]").forEach(btn =>
    btn.addEventListener("click", () => goTo(btn.dataset.goto))
  );

  $("#mobileMenu").addEventListener("click", () => {
    $("#sidebar").classList.toggle("open");
    $("#overlay").classList.toggle("show");
  });

  $("#overlay").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#overlay").classList.remove("show");
  });

  $("#quickAddBtn").addEventListener("click", () => openTaskModal());
  $("#newTaskBtn").addEventListener("click", () => openTaskModal());

  $("#newPlanningBtn").addEventListener("click", () =>
    openPlanningModal(null, { date: dateKey(calendarCursor) })
  );

  $("#newProjectBtn").addEventListener("click", () => openProjectModal());
  $("#newNoteBtn").addEventListener("click", () => openNoteModal());

  $("#settingsBtn").addEventListener("click", () => {
    const c = readCloudConfig();

    $("#supabaseUrl").value = c.url || "";
    $("#supabaseKey").value = c.key || "";
    $("#cloudStatus").textContent = "";

    openModal("cloudModal");
  });

  $("#taskForm").addEventListener("submit", saveTask);
  $("#planningForm").addEventListener("submit", savePlanning);
  $("#projectForm").addEventListener("submit", saveProject);
  $("#noteForm").addEventListener("submit", saveNoteFromModal);

  $("#cloudForm").addEventListener("submit", e => e.preventDefault());
  $("#cloudConnect").addEventListener("click", () => cloudAuth(false));
  $("#cloudSignUp").addEventListener("click", () => cloudAuth(true));

  $$("[data-close]").forEach(btn =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );

  $$(".modal").forEach(dialog => {
    dialog.addEventListener("click", e => {
      if (e.target === dialog) dialog.close();
    });
  });

  $("#taskFilters").addEventListener("click", e => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;

    taskFilter = b.dataset.filter;

    $$("[data-filter]", $("#taskFilters")).forEach(x =>
      x.classList.toggle("selected", x === b)
    );

    renderTasks();
  });

  $("#taskProjectFilter").addEventListener("change", renderTasks);
  $("#taskSort").addEventListener("change", renderTasks);
  $("#projectSearch").addEventListener("input", renderProjects);
  $("#projectStatusFilter").addEventListener("change", renderProjects);
  $("#noteSearch").addEventListener("input", renderNoteListOnly);

  $("#globalSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") globalSearch();
  });

  $("#globalSearch").addEventListener("search", globalSearch);

  $("#calendarModes").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;

    calendarMode = b.dataset.mode;

    $$("[data-mode]", $("#calendarModes")).forEach(x =>
      x.classList.toggle("selected", x === b)
    );

    renderCalendar();
  });

  $("#prevPeriod").addEventListener("click", () => {
    calendarCursor = calendarMode === "month"
      ? new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 15, 12)
      : dateAdd(calendarCursor, calendarMode === "week" ? -7 : -1);

    renderCalendar();
  });

  $("#nextPeriod").addEventListener("click", () => {
    calendarCursor = calendarMode === "month"
      ? new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 15, 12)
      : dateAdd(calendarCursor, calendarMode === "week" ? 7 : 1);

    renderCalendar();
  });

  $("#todayPeriod").addEventListener("click", () => {
    calendarCursor = new Date();
    calendarCursor.setHours(12, 0, 0, 0);
    renderCalendar();
  });

  // Gestion centralisée des boutons dans les éléments générés.
  document.addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;

    if (action === "new-task") openTaskModal();
    if (action === "new-planning") openPlanningModal();
    if (action === "new-project") openProjectModal();
    if (action === "new-note") openNoteModal();

    const editTaskId =
      e.target.closest("[data-edit-task]")?.dataset.editTask;

    const deleteTaskId =
      e.target.closest("[data-delete-task]")?.dataset.deleteTask;

    const complete = e.target.closest("[data-complete-task]");

    const editPlanningId =
      e.target.closest("[data-edit-planning]")?.dataset.editPlanning;

    const deletePlanningId =
      e.target.closest("[data-delete-planning]")?.dataset.deletePlanning;

    const editProject =
      e.target.closest("[data-edit-project]")?.dataset.editProject;

    const deleteProjectId =
      e.target.closest("[data-delete-project]")?.dataset.deleteProject;

    const selectNote =
      e.target.closest("[data-select-note]")?.dataset.selectNote;

    const openNote =
      e.target.closest("[data-open-note]")?.dataset.openNote;

    const projectNotes =
      e.target.closest("[data-project-notes]")?.dataset.projectNotes;

    const deleteNoteId =
      e.target.closest("[data-delete-note]")?.dataset.deleteNote;

    const toTask =
      e.target.closest("[data-note-to-task]")?.dataset.noteToTask;

    const saveNoteBtn = e.target.closest("#saveNoteBtn");

    if (editTaskId) openTaskModal(taskById(editTaskId));
    if (deleteTaskId) deleteTask(deleteTaskId);

    if (complete) {
      toggleTaskDone(complete.dataset.completeTask, complete.checked);
    }

    if (editPlanningId) {
      openPlanningModal(planningById(editPlanningId));
    }

    if (deletePlanningId) deletePlanning(deletePlanningId);

    if (editProject) openProjectModal(projectById(editProject));
    if (deleteProjectId) deleteProject(deleteProjectId);

    if (projectNotes) openProjectNotebook(projectNotes);

    if (selectNote || openNote) {
      selectedNoteId = selectNote || openNote;
      goTo("notes");
    }

    if (deleteNoteId) deleteNote(deleteNoteId);
    if (toTask) noteToTask(toTask);
    if (saveNoteBtn) saveCurrentNote();
  });

  document.addEventListener("input", e => {
    if (
      e.target.id === "editNoteTitle" ||
      e.target.id === "editNoteContent"
    ) {
      scheduleNoteSave();
    }
  });

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#globalSearch").focus();
    }

    if (e.key === "Escape") {
      $("#sidebar").classList.remove("open");
      $("#overlay").classList.remove("show");
    }
  });

  renderAll();

  window.addEventListener("load", () => initCloud());
})();