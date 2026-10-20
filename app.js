"use strict";

/* ===================================================
   Mein Dashboard – Version 1.1
   Daten liegen in Supabase. Zugriff nur nach Anmeldung.
   =================================================== */

/* ===== Konstanten ===== */
const DEFAULT_CATEGORIES = ["Privat", "Foto & Video", "Camper & Reisen"];
const PRIORITY_RANK = { hoch: 0, mittel: 1, niedrig: 2 };
const PRIORITY_LABEL = { hoch: "Hoch", mittel: "Mittel", niedrig: "Niedrig" };
const EDIT_TABLE = { task: "tasks", note: "notes", link: "links", reel: "reels", trip: "trips" };
const EDIT_HEADING = {
  task: "Aufgabe bearbeiten",
  note: "Notiz bearbeiten",
  link: "Schnellzugriff bearbeiten",
  reel: "Reel bearbeiten",
  trip: "Reise bearbeiten",
};

/* ===== Zustand ===== */
let sb = null;
let data = { categories: [], tasks: [], notes: [], links: [], reels: [], trips: [], trip_items: [] };
let taskFilter = "Alle";
let noteFilter = "Alle";
let editTarget = null;

/* ===== Hilfsfunktionen ===== */
function todayISO() {
  const d = new Date();
  return toISO(d);
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + days));
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
}

function formatRange(start, end) {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start || end) return formatDate(start || end);
  return "";
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(task) {
  return !task.done && Boolean(task.due) && task.due < todayISO();
}

function categoryNames() {
  return data.categories.length ? data.categories.map((c) => c.name) : DEFAULT_CATEGORIES;
}

/* Macht aus Eingaben wie "example.de" eine sichere Web-Adresse. Sonst leerer Text. */
function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/* Baut ein HTML-Element. Texte werden immer als reiner Text eingesetzt (sicher). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "value" || key === "checked") el[key] = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function fillSelect(id, names, withNone = false) {
  const options = [];
  if (withNone) options.push(h("option", { value: "", text: "Ohne Bereich" }));
  options.push(...names.map((n) => h("option", { value: n, text: n })));
  document.getElementById(id).replaceChildren(...options);
}

function emptyItem(text) {
  return h("li", { class: "empty", text });
}

function tag(text) {
  return h("span", { class: "tag", text });
}

/* ===== Datenbank-Zugriffe ===== */

/* Führt einen Schreibvorgang aus, lädt danach alles neu und meldet Fehler verständlich. */
async function run(request) {
  const { error } = await request;
  if (error) {
    const message =
      error.code === "23505"
        ? "Diesen Eintrag gibt es schon."
        : "Speichern hat nicht geklappt: " + error.message;
    alert(message);
    return false;
  }
  await loadAll();
  return true;
}

function removeItem(table, id, question) {
  if (!confirm(question)) return;
  run(sb.from(table).delete().eq("id", id));
}

async function loadAll() {
  const queries = {
    categories: sb.from("categories").select("*").order("sort_order").order("name"),
    tasks: sb.from("tasks").select("*").order("created_at"),
    notes: sb.from("notes").select("*").order("created_at", { ascending: false }),
    links: sb.from("links").select("*").order("created_at"),
    reels: sb.from("reels").select("*").order("created_at", { ascending: false }),
    trips: sb.from("trips").select("*").order("start_date", { ascending: true, nullsFirst: false }),
    trip_items: sb.from("trip_items").select("*").order("created_at"),
  };

  const names = Object.keys(queries);
  const results = await Promise.all(names.map((name) => queries[name]));

  for (let i = 0; i < names.length; i++) {
    if (results[i].error) {
      alert("Die Daten konnten nicht geladen werden: " + results[i].error.message);
      return;
    }
    data[names[i]] = results[i].data ?? [];
  }

  renderAll();
}

/* ===== Sortierung ===== */
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.due !== b.due) return a.due ? -1 : 1;
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priority) return priority;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* ===== Anzeige: Kopfbereich & Startseite ===== */
function renderHeader() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  document.getElementById("todayDate").textContent = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  document.getElementById("greeting").textContent = greeting + "!";
}

function renderWeek() {
  const today = todayISO();
  const end = addDays(today, 6);
  const open = data.tasks.filter((t) => !t.done);
  const items = sortTasks(open.filter((t) => t.due && t.due <= end));

  document.getElementById("statOpen").textContent = open.length;
  document.getElementById("statWeek").textContent = items.filter((t) => t.due >= today).length;
  document.getElementById("statOverdue").textContent = open.filter(isOverdue).length;

  const list = document.getElementById("weekList");
  if (items.length === 0) {
    list.replaceChildren(emptyItem("Keine Aufgaben in den nächsten 7 Tagen."));
    return;
  }

  list.replaceChildren(
    ...items.map((task) =>
      h(
        "li",
        { class: "today-item" },
        h("span", { text: task.title }),
        h(
          "span",
          { class: "small meta" },
          h("span", { class: isOverdue(task) ? "overdue" : "", text: (isOverdue(task) ? "Überfällig · " : "") + formatDate(task.due) }),
          tag(task.category),
          h("span", { class: "badge prio-" + task.priority, text: PRIORITY_LABEL[task.priority] })
        )
      )
    )
  );
}

/* ===== Anzeige: Aufgaben ===== */
function renderFilterChips(containerId, current, setFilter, render) {
  document.getElementById(containerId).replaceChildren(
    ...["Alle", ...categoryNames()].map((name) =>
      h("button", {
        type: "button",
        class: "chip" + (name === current ? " active" : ""),
        text: name,
        "aria-pressed": String(name === current),
        onclick: () => {
          setFilter(name);
          render();
        },
      })
    )
  );
}

function renderTasks() {
  renderFilterChips(
    "taskFilterChips",
    taskFilter,
    (name) => (taskFilter = name),
    renderTasks
  );

  const items = sortTasks(data.tasks).filter((t) => taskFilter === "Alle" || t.category === taskFilter);
  const list = document.getElementById("taskList");
  if (items.length === 0) {
    list.replaceChildren(emptyItem(data.tasks.length ? "Keine Aufgaben in diesem Bereich." : "Noch keine Aufgaben. Lege oben die erste an."));
    return;
  }
  list.replaceChildren(...items.map(renderTaskItem));
}

function renderTaskItem(task) {
  const checkbox = h("input", {
    type: "checkbox",
    checked: task.done,
    "aria-label": "Als erledigt markieren",
    onchange: () => run(sb.from("tasks").update({ done: checkbox.checked }).eq("id", task.id)),
  });

  return h(
    "li",
    { class: "task" + (task.done ? " done" : "") },
    checkbox,
    h(
      "div",
      { class: "task-body" },
      h("span", { class: "task-title", text: task.title }),
      h(
        "div",
        { class: "meta" },
        tag(task.category),
        task.subcategory ? tag(task.subcategory) : null,
        h("span", { class: "badge prio-" + task.priority, text: PRIORITY_LABEL[task.priority] }),
        task.due ? h("span", { class: isOverdue(task) ? "overdue" : "", text: (isOverdue(task) ? "Überfällig · " : "") + formatDate(task.due) }) : null
      )
    ),
    h(
      "div",
      { class: "row-actions" },
      h("button", { type: "button", class: "ghost", text: "Bearbeiten", onclick: () => openEdit("task", task.id) }),
      h("button", {
        type: "button",
        class: "ghost danger",
        text: "Löschen",
        onclick: () => removeItem("tasks", task.id, `„${task.title}“ wirklich löschen?`),
      })
    )
  );
}

/* ===== Anzeige: Notizen ===== */
function renderNotes() {
  renderFilterChips("noteFilterChips", noteFilter, (name) => (noteFilter = name), renderNotes);

  const items = data.notes.filter((n) => noteFilter === "Alle" || n.category === noteFilter);
  const list = document.getElementById("noteList");
  if (items.length === 0) {
    list.replaceChildren(emptyItem("Keine Notizen in diesem Bereich."));
    return;
  }

  list.replaceChildren(
    ...items.map((note) =>
      h(
        "li",
        { class: "note" },
        h("p", { class: "note-text", text: note.text }),
        h(
          "div",
          { class: "row-actions" },
          note.category ? tag(note.category) : null,
          h("span", { class: "muted small", text: formatDateTime(note.created_at) }),
          h("button", { type: "button", class: "ghost", text: "Bearbeiten", onclick: () => openEdit("note", note.id) }),
          h("button", {
            type: "button",
            class: "ghost danger",
            text: "Löschen",
            onclick: () => removeItem("notes", note.id, "Diese Notiz wirklich löschen?"),
          })
        )
      )
    )
  );
}

/* ===== Anzeige: Schnellzugriffe (nach Bereich gruppiert) ===== */
function renderLinks() {
  const container = document.getElementById("linkList");
  if (data.links.length === 0) {
    container.replaceChildren(h("p", { class: "empty", text: "Noch keine Schnellzugriffe." }));
    return;
  }

  const groups = new Map();
  for (const link of data.links) {
    const key = link.category || "Ohne Bereich";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  }

  const names = categoryNames();
  const rank = (key) => (key === "Ohne Bereich" ? 1e6 : names.includes(key) ? names.indexOf(key) : 1e5);
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  container.replaceChildren(
    ...keys.map((key) =>
      h(
        "div",
        { class: "group" },
        h("h3", { class: "group-title", text: key }),
        h(
          "ul",
          { class: "list" },
          ...groups.get(key).map((link) =>
            h(
              "li",
              { class: "link-item" },
              h(
                "a",
                { class: "link-main", href: link.url, target: "_blank", rel: "noopener noreferrer" },
                h("span", { class: "link-name", text: link.name }),
                h("span", { class: "small muted", text: new URL(link.url).hostname })
              ),
              h(
                "div",
                { class: "row-actions" },
                h("button", { type: "button", class: "ghost", text: "Bearbeiten", onclick: () => openEdit("link", link.id) }),
                h("button", {
                  type: "button",
                  class: "ghost danger",
                  text: "Löschen",
                  onclick: () => removeItem("links", link.id, `„${link.name}“ wirklich entfernen?`),
                })
              )
            )
          )
        )
      )
    )
  );
}

/* ===== Anzeige: Reels ===== */
function renderReels() {
  const list = document.getElementById("reelList");
  if (data.reels.length === 0) {
    list.replaceChildren(emptyItem("Noch keine Reels gespeichert."));
    return;
  }

  list.replaceChildren(
    ...data.reels.map((reel) =>
      h(
        "li",
        { class: "note" },
        h(
          "a",
          { class: "link-main", href: reel.url, target: "_blank", rel: "noopener noreferrer" },
          h("span", { class: "link-name", text: reel.title || new URL(reel.url).hostname }),
          h("span", { class: "small muted", text: reel.title ? new URL(reel.url).hostname : "" })
        ),
        reel.note ? h("p", { class: "note-text", text: reel.note }) : null,
        h(
          "div",
          { class: "row-actions" },
          reel.category ? tag(reel.category) : null,
          h("button", { type: "button", class: "ghost", text: "Bearbeiten", onclick: () => openEdit("reel", reel.id) }),
          h("button", {
            type: "button",
            class: "ghost danger",
            text: "Löschen",
            onclick: () => removeItem("reels", reel.id, "Dieses Reel wirklich entfernen?"),
          })
        )
      )
    )
  );
}

/* ===== Anzeige: Camper & Reisen ===== */
function renderTrips() {
  const list = document.getElementById("tripList");
  if (data.trips.length === 0) {
    list.replaceChildren(emptyItem("Noch keine Reisen oder Touren. Lege oben die erste an."));
    return;
  }

  list.replaceChildren(
    ...data.trips.map((trip) => {
      const items = data.trip_items.filter((i) => i.trip_id === trip.id);
      const doneCount = items.filter((i) => i.done).length;
      const range = formatRange(trip.start_date, trip.end_date);
      const summary = [trip.kind, trip.location, range, `Packliste ${doneCount}/${items.length}`]
        .filter(Boolean)
        .join(" · ");

      return h(
        "li",
        { class: "trip" },
        h(
          "details",
          {},
          h("summary", {}, h("span", { class: "trip-title", text: trip.title }), h("span", { class: "small muted", text: summary })),
          h(
            "div",
            { class: "trip-body" },
            trip.notes ? h("p", { class: "note-text", text: trip.notes }) : null,
            h(
              "ul",
              { class: "list" },
              ...items.map((item) => {
                const checkbox = h("input", {
                  type: "checkbox",
                  checked: item.done,
                  "aria-label": "Packpunkt abhaken",
                  onchange: () => run(sb.from("trip_items").update({ done: checkbox.checked }).eq("id", item.id)),
                });
                return h(
                  "li",
                  { class: "task" + (item.done ? " done" : "") },
                  checkbox,
                  h("span", { class: "task-body task-title", text: item.text }),
                  h("button", {
                    type: "button",
                    class: "ghost danger",
                    text: "×",
                    "aria-label": "Packpunkt löschen",
                    onclick: () => removeItem("trip_items", item.id, "Diesen Packpunkt löschen?"),
                  })
                );
              })
            ),
            h(
              "form",
              {
                class: "inline-form",
                onsubmit: (event) => {
                  event.preventDefault();
                  const input = event.target.elements.text;
                  const text = input.value.trim();
                  if (!text) return;
                  run(sb.from("trip_items").insert({ trip_id: trip.id, text: text.slice(0, 200) }));
                },
              },
              h("input", { name: "text", placeholder: "Packliste: Punkt hinzufügen", maxlength: 200, autocomplete: "off" }),
              h("button", { type: "submit", class: "ghost", text: "+" })
            ),
            h(
              "div",
              { class: "row-actions" },
              h("button", { type: "button", class: "ghost", text: "Bearbeiten", onclick: () => openEdit("trip", trip.id) }),
              h("button", {
                type: "button",
                class: "ghost danger",
                text: "Reise löschen",
                onclick: () => removeItem("trips", trip.id, `„${trip.title}“ mit Packliste löschen?`),
              })
            )
          )
        )
      );
    })
  );
}

/* ===== Anzeige: Bereiche (Kategorien) ===== */
function renderCategories() {
  const list = document.getElementById("catList");
  if (data.categories.length === 0) {
    list.replaceChildren(emptyItem("Noch keine Bereiche."));
    return;
  }

  list.replaceChildren(
    ...data.categories.map((cat) =>
      h(
        "li",
        { class: "task" },
        h("span", { class: "task-body task-title", text: cat.name }),
        h("button", {
          type: "button",
          class: "ghost danger",
          text: "Löschen",
          onclick: () =>
            removeItem(
              "categories",
              cat.id,
              `Bereich „${cat.name}“ löschen? Vorhandene Einträge behalten ihren Namen, verlieren aber den Filter.`
            ),
        })
      )
    )
  );
}

function renderSelects() {
  const names = categoryNames();
  fillSelect("taskCategory", names);
  fillSelect("noteCategory", names, true);
  fillSelect("linkCategory", names, true);
  fillSelect("reelCategory", names, true);
  fillSelect("editCategory", names, true);
}

function renderAll() {
  renderHeader();
  renderSelects();
  renderWeek();
  renderTasks();
  renderNotes();
  renderLinks();
  renderReels();
  renderTrips();
  renderCategories();
}

/* ===== Formulare: Neu anlegen ===== */
document.getElementById("taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const title = document.getElementById("taskTitle").value.trim();
  if (!title) return;

  const ok = await run(
    sb.from("tasks").insert({
      title: title.slice(0, 200),
      due: document.getElementById("taskDue").value || null,
      category: document.getElementById("taskCategory").value || categoryNames()[0],
      subcategory: document.getElementById("taskSub").value.trim().slice(0, 60) || null,
      priority: document.getElementById("taskPriority").value,
    })
  );
  if (ok) form.reset();
});

document.getElementById("noteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const text = document.getElementById("noteText").value.trim();
  if (!text) return;

  const ok = await run(
    sb.from("notes").insert({
      text: text.slice(0, 5000),
      category: document.getElementById("noteCategory").value || null,
    })
  );
  if (ok) form.reset();
});

document.getElementById("linkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const url = normalizeUrl(document.getElementById("linkUrl").value);
  if (!url) {
    alert("Bitte eine gültige Adresse eingeben, z. B. example.de");
    return;
  }
  const name = document.getElementById("linkName").value.trim().slice(0, 100) || new URL(url).hostname;

  const ok = await run(
    sb.from("links").insert({
      name,
      url,
      category: document.getElementById("linkCategory").value || null,
    })
  );
  if (ok) form.reset();
});

document.getElementById("reelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const url = normalizeUrl(document.getElementById("reelUrl").value);
  if (!url) {
    alert("Bitte einen gültigen Link zum Reel einfügen.");
    return;
  }

  const ok = await run(
    sb.from("reels").insert({
      url,
      title: document.getElementById("reelTitle").value.trim().slice(0, 200) || null,
      category: document.getElementById("reelCategory").value || null,
      note: document.getElementById("reelNote").value.trim().slice(0, 5000) || null,
    })
  );
  if (ok) form.reset();
});

document.getElementById("tripForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const title = document.getElementById("tripTitle").value.trim();
  const start = document.getElementById("tripStart").value || null;
  const end = document.getElementById("tripEnd").value || null;
  if (!title) return;
  if (start && end && end < start) {
    alert("Das Ende liegt vor dem Start.");
    return;
  }

  const ok = await run(
    sb.from("trips").insert({
      title: title.slice(0, 200),
      kind: document.getElementById("tripKind").value,
      location: document.getElementById("tripLocation").value.trim().slice(0, 200) || null,
      start_date: start,
      end_date: end,
    })
  );
  if (ok) form.reset();
});

document.getElementById("catForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const name = document.getElementById("catName").value.trim();
  if (!name) return;

  const ok = await run(sb.from("categories").insert({ name: name.slice(0, 60), sort_order: data.categories.length + 1 }));
  if (ok) form.reset();
});

/* ===== Datensicherung: alle Einträge als JSON-Datei ===== */
document.getElementById("exportBtn").addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    categories: data.categories,
    tasks: data.tasks,
    notes: data.notes,
    links: data.links,
    reels: data.reels,
    trips: data.trips,
    trip_items: data.trip_items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: `dashboard-sicherung-${todayISO()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ===== Bearbeiten-Dialog ===== */
const editDialog = document.getElementById("editDialog");

function openEdit(type, id) {
  const item = data[EDIT_TABLE[type]].find((i) => i.id === id);
  if (!item) return;

  editTarget = { type, id };
  document.getElementById("editHeading").textContent = EDIT_HEADING[type];
  document.getElementById("editError").hidden = true;

  document.getElementById("editTitle").value = item.title ?? item.name ?? "";
  document.getElementById("editUrl").value = item.url ?? "";
  document.getElementById("editCategory").value = item.category ?? "";
  document.getElementById("editSub").value = item.subcategory ?? "";
  document.getElementById("editDue").value = item.due ?? "";
  document.getElementById("editPriority").value = item.priority ?? "mittel";
  document.getElementById("editLocation").value = item.location ?? "";
  document.getElementById("editStart").value = item.start_date ?? "";
  document.getElementById("editEnd").value = item.end_date ?? "";
  document.getElementById("editBody").value =
    type === "note" ? item.text : type === "reel" ? item.note ?? "" : type === "trip" ? item.notes ?? "" : "";

  // Nur die Felder anzeigen, die zu diesem Eintrag passen.
  document.querySelectorAll("#editForm [data-for]").forEach((group) => {
    group.hidden = !group.dataset.for.split(" ").includes(type);
  });

  editDialog.showModal();
}

function showEditError(message) {
  const el = document.getElementById("editError");
  el.textContent = message;
  el.hidden = false;
}

document.getElementById("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editTarget) return;

  const { type, id } = editTarget;
  const title = document.getElementById("editTitle").value.trim();
  const category = document.getElementById("editCategory").value;
  let patch;

  if (type === "task") {
    if (!title) return showEditError("Bitte einen Titel eingeben.");
    patch = {
      title: title.slice(0, 200),
      category: category || categoryNames()[0],
      subcategory: document.getElementById("editSub").value.trim().slice(0, 60) || null,
      due: document.getElementById("editDue").value || null,
      priority: document.getElementById("editPriority").value,
    };
  } else if (type === "link") {
    const url = normalizeUrl(document.getElementById("editUrl").value);
    if (!url) return showEditError("Bitte eine gültige Adresse eingeben.");
    patch = { name: title.slice(0, 100) || new URL(url).hostname, url, category: category || null };
  } else if (type === "reel") {
    const url = normalizeUrl(document.getElementById("editUrl").value);
    if (!url) return showEditError("Bitte einen gültigen Link eingeben.");
    patch = {
      url,
      title: title.slice(0, 200) || null,
      category: category || null,
      note: document.getElementById("editBody").value.trim().slice(0, 5000) || null,
    };
  } else if (type === "note") {
    const text = document.getElementById("editBody").value.trim();
    if (!text) return showEditError("Bitte einen Text eingeben.");
    patch = { text: text.slice(0, 5000), category: category || null };
  } else {
    if (!title) return showEditError("Bitte einen Titel eingeben.");
    const start = document.getElementById("editStart").value || null;
    const end = document.getElementById("editEnd").value || null;
    if (start && end && end < start) return showEditError("Das Ende liegt vor dem Start.");
    patch = {
      title: title.slice(0, 200),
      location: document.getElementById("editLocation").value.trim().slice(0, 200) || null,
      start_date: start,
      end_date: end,
      notes: document.getElementById("editBody").value.trim().slice(0, 5000) || null,
    };
  }

  if (await run(sb.from(EDIT_TABLE[type]).update(patch).eq("id", id))) {
    editTarget = null;
    editDialog.close();
  }
});

document.getElementById("editCancel").addEventListener("click", () => editDialog.close());
editDialog.addEventListener("close", () => {
  editTarget = null;
});

/* ===== Anmeldung ===== */
function showLogin() {
  document.getElementById("loginView").hidden = false;
  document.getElementById("appView").hidden = true;
}

function showApp() {
  document.getElementById("loginView").hidden = true;
  document.getElementById("appView").hidden = false;
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const msg = document.getElementById("loginMsg");
  msg.textContent = "Der Anmelde-Link wird gesendet …";

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });

  msg.textContent = error
    ? "Das hat nicht geklappt: " + error.message
    : "Fertig. Öffne den Link in deiner E-Mail auf diesem Gerät.";
});

document.getElementById("passwordLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("pwEmail").value.trim();
  const password = document.getElementById("pwPassword").value;
  const msg = document.getElementById("loginMsg");
  msg.textContent = "Anmeldung läuft …";

  const { error } = await sb.auth.signInWithPassword({ email, password });
  msg.textContent = error ? "Anmeldung fehlgeschlagen. E-Mail oder Passwort prüfen." : "";
  if (!error) document.getElementById("pwPassword").value = "";
});

document.getElementById("setPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("newPassword");
  const msg = document.getElementById("pwMsg");
  if (input.value.length < 8) {
    msg.textContent = "Das Passwort braucht mindestens 8 Zeichen.";
    return;
  }

  const { error } = await sb.auth.updateUser({ password: input.value });
  if (error) {
    msg.textContent = "Speichern hat nicht geklappt: " + error.message;
    return;
  }
  input.value = "";
  msg.textContent = "Passwort gespeichert. Ab jetzt kannst du dich damit anmelden.";
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
});

/* ===== Hell / Dunkel ===== */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("themeToggle").textContent = theme === "dark" ? "Hell" : "Dunkel";
}

function initTheme() {
  const saved = localStorage.getItem("mein-dashboard-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

document.getElementById("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("mein-dashboard-theme", next);
  applyTheme(next);
});

/* ===== Reel aus dem Kurzbefehl übernehmen =====
   Adresse wie ...?reel=https://instagram.com/reel/... → Link wird ins Reel-Feld eingetragen. */
function takePendingReelFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("reel");
  if (!raw) return;

  const match = raw.match(/https?:\/\/[^\s]+/);
  try {
    if (match) localStorage.setItem("mein-dashboard-pending-reel", match[0]);
  } catch {
    // Speicher nicht verfügbar: der Link wird dann nicht übernommen.
  }
  window.history.replaceState(null, "", window.location.pathname);
}

function applyPendingReel() {
  let pending = null;
  try {
    pending = localStorage.getItem("mein-dashboard-pending-reel");
    if (pending) localStorage.removeItem("mein-dashboard-pending-reel");
  } catch {
    return;
  }
  if (!pending) return;

  showSection("reels");
  document.getElementById("reelUrl").value = pending;
  document.getElementById("reelForm").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("reelTitle").focus();
}

takePendingReelFromUrl();

/* ===== Bereiche (Leiste oben) ===== */
const SECTION_KEY = "mein-dashboard-section";
const SECTIONS = ["start", "tasks", "notes", "links", "reels", "trips", "settings"];

function showSection(name) {
  const target = SECTIONS.includes(name) ? name : "start";
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== target;
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === target));
  });
  try {
    localStorage.setItem(SECTION_KEY, target);
  } catch {
    // Ohne Speicher wird der Bereich beim nächsten Öffnen nicht gemerkt.
  }
}

function savedSection() {
  try {
    return localStorage.getItem(SECTION_KEY);
  } catch {
    return null;
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    showSection(tab.dataset.tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

/* ===== Start ===== */
initTheme();
showSection(savedSection() || "start");

if (!window.supabase || !window.DASHBOARD_CONFIG) {
  showLogin();
  document.getElementById("loginMsg").textContent =
    "Die Verbindung konnte nicht geladen werden. Bitte Internetverbindung prüfen und die Seite neu laden.";
} else {
  const { supabaseUrl, supabaseKey } = window.DASHBOARD_CONFIG;
  sb = window.supabase.createClient(supabaseUrl, supabaseKey);

  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      showApp();
      loadAll().then(applyPendingReel);
    } else {
      showLogin();
    }
  });
}

// Datum und Wochenansicht aktualisieren, falls die Seite über Mitternacht offen bleibt.
setInterval(() => {
  if (sb) {
    renderHeader();
    renderWeek();
  }
}, 60 * 1000);
