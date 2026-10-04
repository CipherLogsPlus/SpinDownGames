import { el } from "./views.js";
import { validReleaseDate } from "../domain/showcase.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const emptyDraft = () => ({ name: "", description: "", number: "", rarity: "", edition: "" });
const draftFields = row => row ? {
  name: row.name, description: row.description || "", number: row.character_number == null ? "" : String(row.character_number),
  rarity: row.rarity || "", edition: row.edition || "",
} : emptyDraft();
const snapshotContent = (row, published = false) => ({
  name: row.name, number: published ? row.number : row.character_number,
  description: row.description || "", rarity: row.rarity || null, edition: row.edition || null,
  artworkUrl: row.artworkUrl || null,
});
export function hasSavedDraftChanges(row) {
  return Boolean(row?.publication && JSON.stringify(snapshotContent(row)) !== JSON.stringify(snapshotContent(row.publication, true)));
}
function validDate(value) {
  return value === null || validReleaseDate(value);
}

/** The preview and mutation share one captured saved revision and content source. */
export function publicationPlan(row, { visibility, releaseDate = null, useSavedDraft }, dirty = false) {
  if (!row?.id || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Save a draft first.");
  if (dirty) throw new Error("Save or discard your draft changes before changing member visibility.");
  if (!["public", "upcoming", "private"].includes(visibility) || typeof useSavedDraft !== "boolean" || !validDate(releaseDate))
    throw new Error("Choose Coming soon or a valid calendar date.");
  if (!useSavedDraft && !row.publication) throw new Error("This Veiling has no member version yet. Publish its saved draft first.");
  const content = snapshotContent(useSavedDraft ? row : row.publication, !useSavedDraft);
  return Object.freeze({
    input: Object.freeze({ id: row.id, revision: row.revision, visibility, releaseDate: visibility === "upcoming" ? releaseDate : null, useSavedDraft }),
    content: Object.freeze(content),
  });
}

export async function validateStudioArtwork(file) {
  if (!file) return;
  if (!IMAGE_TYPES.has(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ARTWORK_BYTES)
    throw new Error("Choose a PNG, JPEG, or WebP image no larger than 8 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const valid = file.type === "image/png"
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid) throw new Error("The selected file does not match its image format. Choose a PNG, JPEG, or WebP image.");
}

function button(text, id = "", className = "outlined-button") {
  const node = el("button", className, text);
  node.type = "button";
  if (id) node.id = id;
  return node;
}
function field(label, id, { type = "text", value = "", maxLength, required = false, rows } = {}) {
  const wrapper = el("div", "studio-field");
  const caption = el("label", "", label);
  caption.htmlFor = id;
  const input = el(rows ? "textarea" : "input");
  input.id = id;
  if (rows) input.rows = rows;
  else input.type = type;
  if (maxLength) input.maxLength = maxLength;
  input.required = required;
  if (type !== "file") input.value = value;
  wrapper.append(caption, input);
  return { wrapper, input };
}
function feedback(id) {
  const node = el("p", "studio-feedback");
  node.id = id;
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  return node;
}
function artwork(url, name, className = "studio-artwork") {
  const image = el("img", className);
  image.src = url;
  image.alt = "Artwork for " + name;
  image.addEventListener("error", () => image.replaceWith(el("p", "studio-note", "Artwork preview unavailable.")), { once: true });
  return image;
}
function visibilityName(row) {
  return row.publication?.visibility === "public" ? "Public · members" : row.publication?.visibility === "upcoming" ? "Upcoming" : "Draft";
}
function errorText(error) {
  if (["STALE_REVISION", "REVISION_REQUIRED"].includes(error?.code)) return "This Veiling changed elsewhere. Discard edits and reload its saved draft before continuing.";
  if (error?.code === "NUMBER_IN_USE") return "That character number is already in use. Choose another number or leave it blank.";
  if (["ACCESS_DENIED", "AUTH_REQUIRED"].includes(error?.code)) return "Studio access is no longer available. Sign in again or return to your collection.";
  if (error?.code === "PUBLICATION_REQUIRED") return "The member version changed. Reload this Veiling before continuing.";
  return "The request could not be completed. Try again; no further changes have been confirmed.";
}

export function createVeilingStudio({ root, service, getSession, onChanged = () => {} }) {
  let current = null;
  let readRequest = null;
  let readSequence = 0;
  const active = state => current === state && getSession() === state.identity;

  function reset() {
    const previous = current;
    current = null;
    readSequence++;
    readRequest?.abort();
    readRequest = null;
    if (previous?.ui.dialog.open) previous.ui.dialog.close();
    root.replaceChildren();
  }
  function announce(state, message, error = false) {
    if (!active(state)) return;
    const target = state.ui.editorFeedback || state.ui.listFeedback;
    target.textContent = message;
    target.classList.toggle("is-error", error);
  }
  function values(state) {
    return Object.fromEntries(Object.entries(state.ui.fields).map(([name, input]) => [name, input.value.trim()]));
  }
  function dirty(state) {
    return Boolean(state.ui.file?.files?.length) || Boolean(state.ui.fields && JSON.stringify(values(state)) !== JSON.stringify(draftFields(state.selected)));
  }
  function notify(row) {
    try { Promise.resolve(onChanged(row)).catch(() => {}); } catch { /* Saved state is already confirmed. */ }
  }
  function upsert(state, row) {
    const index = state.rows.findIndex(item => item.id === row.id);
    if (index < 0) state.rows.unshift(row);
    else state.rows[index] = row;
    state.selected = row;
    state.creating = false;
  }
  function dateValue(state) {
    return state.dateMode === "coming-soon" ? null : state.releaseDate;
  }
  function updateControls(state) {
    if (!active(state)) return;
    const ui = state.ui;
    ui.create.disabled = state.busy || state.loading;
    ui.search.disabled = state.busy || state.loading;
    ui.filters.forEach(node => { node.disabled = state.busy || state.loading; });
    for (const node of ui.list.querySelectorAll("button")) node.disabled = state.busy || state.loading;
    if (!ui.form) return;
    const unsaved = dirty(state);
    ui.fieldset.disabled = state.busy || state.loading;
    ui.save.disabled = state.busy || state.loading || state.conflict;
    ui.save.textContent = state.busy && !state.preview ? "Saving…" : "Save Draft";
    ui.discard.hidden = !unsaved && !state.conflict;
    ui.discard.disabled = state.busy || state.loading;
    ui.discard.textContent = state.conflict ? "Discard edits and reload" : "Discard changes";
    ui.clearFile.hidden = !ui.file.files?.length;
    ui.draftState.textContent = unsaved ? "Unsaved changes" : state.selected ? "Saved draft" : "Not saved yet";
    const blocked = state.busy || state.loading || state.conflict || unsaved || !state.selected;
    ui.publicationButtons.forEach(node => { node.disabled = blocked; });
    if (ui.changes) ui.changes.disabled = blocked || !hasSavedDraftChanges(state.selected);
    if (ui.dateUpdate) {
      ui.dateUpdate.hidden = dateValue(state) === state.selected?.publication?.releaseDate;
      ui.dateUpdate.disabled = blocked;
    }
    ui.dateMode.disabled = state.busy || state.loading || !state.selected;
    ui.releaseDate.disabled = state.busy || state.loading || !state.selected || state.dateMode !== "date";
    ui.dateField.hidden = state.dateMode !== "date";
    ui.visibilityHint.textContent = !state.selected ? "Save your draft first to choose its member visibility."
      : state.conflict ? "Reload the saved draft before changing member visibility."
        : unsaved ? "Save or discard your draft changes before changing member visibility."
          : "Public means visible to signed-in members. Nothing here publishes automatically.";
    ui.confirm.disabled = state.busy;
    ui.cancel.disabled = state.busy;
  }
  function renderList(state) {
    if (!active(state)) return;
    const { ui } = state;
    const term = state.search.trim().toLocaleLowerCase();
    const rows = state.rows.filter(row => {
      const publication = row.publication;
      if (state.filter === "draft" && publication && !hasSavedDraftChanges(row)) return false;
      if (state.filter === "upcoming" && publication?.visibility !== "upcoming") return false;
      if (state.filter === "public" && publication?.visibility !== "public") return false;
      return !term || `${row.name} ${row.character_number ?? ""} ${row.id}`.toLocaleLowerCase().includes(term);
    });
    ui.list.replaceChildren();
    for (const row of rows) {
      const item = button("", "", "studio-list-item");
      item.dataset.veilingId = row.id;
      item.setAttribute("aria-pressed", String(state.selected?.id === row.id));
      const copy = el("span", "studio-list-copy");
      copy.append(el("strong", "", row.name), el("span", "studio-list-number", row.character_number == null ? "No number assigned" : "Veiling " + String(row.character_number).padStart(3, "0")));
      const tags = el("span", "studio-list-tags");
      tags.append(el("span", "studio-badge", visibilityName(row)));
      if (hasSavedDraftChanges(row)) tags.append(el("span", "studio-badge studio-badge-draft", "Draft changes"));
      item.append(copy, tags);
      item.addEventListener("click", () => select(state, row));
      ui.list.append(item);
    }
    if (!rows.length) ui.list.append(el("p", "studio-empty", state.rows.length ? "No Veilings match this view." : "No Veilings created yet. Start with a name."));
    ui.count.textContent = `${rows.length} ${rows.length === 1 ? "Veiling" : "Veilings"}`;
    ui.filters.forEach(node => node.setAttribute("aria-pressed", String(node.dataset.filter === state.filter)));
    updateControls(state);
  }
  function mayLeaveDraft(state) {
    if (state.busy || state.loading) return false;
    if (!dirty(state)) return true;
    announce(state, "Save or discard your changes before opening another Veiling.", true);
    state.ui.discard.focus();
    return false;
  }
  function select(state, row, force = false) {
    if (!active(state) || (!force && !mayLeaveDraft(state))) return;
    state.selected = row;
    state.creating = !row;
    state.conflict = false;
    state.dateMode = row?.publication?.releaseDate ? "date" : "coming-soon";
    state.releaseDate = row?.publication?.releaseDate || "";
    renderEditor(state);
    renderList(state);
    state.ui.fields.name.focus({ preventScroll: true });
  }
  function renderVisibility(state) {
    const { ui, selected } = state;
    const panel = el("section", "studio-visibility");
    panel.id = "studio-visibility-panel";
    const heading = el("h3", "", "Member visibility");
    heading.id = "studio-visibility-title";
    panel.setAttribute("aria-labelledby", heading.id);
    panel.append(heading, el("p", "studio-publication-status", selected ? visibilityName(selected) : "Draft not saved"));
    if (selected?.publication) panel.append(el("p", "studio-note", "Members see the last version you published. Saving draft edits keeps that version in place."));
    else panel.append(el("p", "studio-note", "Your draft stays private until you explicitly publish it for members."));
    ui.visibilityHint = el("p", "studio-note");
    ui.visibilityHint.id = "studio-visibility-hint";
    panel.append(ui.visibilityHint);
    const timing = el("div", "studio-upcoming-timing");
    const modeLabel = el("label", "", "Upcoming timing");
    modeLabel.htmlFor = "studio-date-mode";
    ui.dateMode = el("select");
    ui.dateMode.id = "studio-date-mode";
    for (const [value, label] of [["coming-soon", "Coming soon"], ["date", "Choose a date"]]) {
      const option = el("option", "", label); option.value = value; ui.dateMode.append(option);
    }
    ui.dateMode.value = state.dateMode;
    const date = field("Announced date", "studio-release-date", { type: "date", value: state.releaseDate });
    ui.dateField = date.wrapper; ui.releaseDate = date.input;
    ui.dateMode.addEventListener("change", () => { state.dateMode = ui.dateMode.value; updateControls(state); });
    ui.releaseDate.addEventListener("input", () => { state.releaseDate = ui.releaseDate.value; updateControls(state); });
    timing.append(modeLabel, ui.dateMode, ui.dateField, el("p", "studio-note", "Dates are informational. You decide when an Upcoming Veiling becomes Public."));
    panel.append(timing);
    const actions = el("div", "studio-visibility-actions");
    ui.publicationButtons = []; ui.changes = null; ui.dateUpdate = null;
    const addAction = (label, action) => {
      const node = button(label); node.dataset.studioAction = action;
      node.setAttribute("aria-describedby", "studio-visibility-hint");
      node.addEventListener("click", () => preview(state, action, node));
      actions.append(node); ui.publicationButtons.push(node); return node;
    };
    if (selected?.publication) ui.changes = addAction("Publish changes", "changes");
    if (selected?.publication?.visibility !== "public") addAction("Make public", "public");
    if (selected?.publication?.visibility !== "upcoming") addAction("Add to Upcoming", "upcoming");
    if (selected?.publication?.visibility === "upcoming") ui.dateUpdate = addAction("Update Upcoming date", "date");
    if (selected?.publication) addAction("Hide from members", "private");
    panel.append(actions);
    ui.visibilityHost.replaceChildren(panel);
  }
  function renderEditor(state) {
    const { ui } = state;
    ui.editor.replaceChildren();
    const heading = el("div", "studio-editor-heading");
    heading.append(el("h3", "", state.selected ? "Draft editor" : "Create a Veiling"));
    ui.draftState = el("span", "studio-badge"); heading.append(ui.draftState);
    ui.editor.append(heading, el("p", "studio-note", "A name is enough to start. Add a description, details, and artwork whenever they are ready."));
    ui.form = el("form"); ui.form.id = "studio-editor-form";
    ui.fieldset = el("fieldset", "studio-fields");
    const legend = el("legend", "sr-only", "Draft content"); ui.fieldset.append(legend);
    const saved = draftFields(state.selected);
    const name = field("Veiling name", "studio-name", { value: saved.name, maxLength: 120, required: true });
    const description = field("Description / lore (optional)", "studio-description", { value: saved.description, maxLength: 20000, rows: 6 });
    const number = field("Character number (optional)", "studio-number", { value: saved.number, type: "number" });
    number.input.min = "1"; number.input.max = "999999"; number.input.step = "1";
    const rarity = field("Rarity (optional)", "studio-rarity", { value: saved.rarity, maxLength: 80 });
    const edition = field("Edition (optional)", "studio-edition", { value: saved.edition, maxLength: 120 });
    ui.fields = { name: name.input, description: description.input, number: number.input, rarity: rarity.input, edition: edition.input };
    const details = el("details", "studio-optional-details");
    details.open = Boolean(saved.number || saved.rarity || saved.edition);
    const optionalFields = el("div", "studio-optional-fields");
    optionalFields.append(number.wrapper, rarity.wrapper, edition.wrapper);
    details.append(el("summary", "", "Optional details"), optionalFields);
    const art = field("Draft artwork (optional)", "studio-artwork", { type: "file" });
    ui.file = art.input; ui.file.accept = "image/png,image/jpeg,image/webp";
    const artHint = el("p", "studio-note", "PNG, JPEG or WebP · up to 8 MB. Artwork is saved to the draft first.");
    artHint.id = "studio-artwork-hint"; ui.file.setAttribute("aria-describedby", artHint.id);
    art.wrapper.append(artHint);
    if (state.selected?.artworkUrl) art.wrapper.append(artwork(state.selected.artworkUrl, state.selected.name));
    ui.clearFile = button("Clear selected artwork", "studio-clear-artwork", "studio-text-button");
    ui.clearFile.addEventListener("click", () => {
      ui.file.value = ""; updateControls(state);
      announce(state, "Selected artwork cleared. Existing saved artwork is unchanged.");
    });
    art.wrapper.append(ui.clearFile);
    ui.fieldset.append(name.wrapper, description.wrapper, details, art.wrapper);
    const actions = el("div", "studio-editor-actions");
    ui.save = button("Save Draft", "studio-save", "outlined-button studio-primary"); ui.save.type = "submit";
    ui.discard = button("Discard changes", "studio-discard");
    ui.discard.addEventListener("click", () => {
      if (state.conflict) void load(state, state.selected?.id);
      else select(state, state.selected, true);
    });
    actions.append(ui.save, ui.discard);
    ui.editorFeedback = feedback("studio-editor-feedback");
    ui.form.append(ui.fieldset, actions, ui.editorFeedback);
    ui.form.addEventListener("input", () => updateControls(state));
    ui.form.addEventListener("change", () => updateControls(state));
    ui.form.addEventListener("submit", event => { event.preventDefault(); void save(state); });
    ui.visibilityHost = el("div");
    ui.editor.append(ui.form, ui.visibilityHost);
    renderVisibility(state);
    updateControls(state);
  }
  async function save(state) {
    if (!active(state) || state.busy || state.loading || state.conflict || !state.ui.form.reportValidity()) return;
    const input = values(state), file = state.ui.file.files?.[0] || null;
    if (!input.name) { announce(state, "Enter a Veiling name.", true); state.ui.fields.name.focus(); return; }
    state.busy = true; updateControls(state); announce(state, "Saving draft…");
    let saved = null;
    try {
      await validateStudioArtwork(file);
      if (!active(state)) return;
      saved = await service.saveVeiling({ ...input, number: input.number === "" ? null : Number(input.number), status: "draft",
        ...(state.selected ? { id: state.selected.id, revision: state.selected.revision } : {}) });
      if (!active(state)) return;
      upsert(state, saved);
      if (file) {
        saved = await service.uploadArtwork({ veilingId: saved.id, revision: saved.revision, file });
        if (!active(state)) return;
        upsert(state, saved);
      }
      renderEditor(state);
      announce(state, saved.publication ? "Draft saved. Members still see the version you last published." : "Draft saved. It is not visible to members.");
      notify(saved);
    } catch (error) {
      if (!active(state)) return;
      state.conflict = ["STALE_REVISION", "REVISION_REQUIRED", "PUBLICATION_REQUIRED"].includes(error?.code);
      if (saved) {
        renderVisibility(state);
        announce(state, state.conflict ? "Draft saved, but artwork was not uploaded. Discard edits and reload before continuing."
          : "Draft saved, but artwork was not uploaded. Your selected file is still pending. Save Draft to retry, or clear the selected artwork.", true);
        notify(saved);
      } else announce(state, error?.code ? errorText(error) : error?.message?.startsWith("Choose ") || error?.message?.startsWith("The selected file") ? error.message : errorText(error), true);
    } finally {
      if (active(state)) { state.busy = false; renderList(state); updateControls(state); }
    }
  }
  function preview(state, action, trigger) {
    if (!active(state) || state.busy || state.loading || state.conflict) return;
    const publication = state.selected?.publication;
    const choices = {
      public: { visibility: "public", releaseDate: null, useSavedDraft: !publication },
      upcoming: { visibility: "upcoming", releaseDate: dateValue(state), useSavedDraft: !publication },
      changes: { visibility: publication?.visibility, releaseDate: publication?.visibility === "upcoming" ? dateValue(state) : publication?.releaseDate || null, useSavedDraft: true },
      private: { visibility: "private", releaseDate: null, useSavedDraft: false },
      date: { visibility: "upcoming", releaseDate: dateValue(state), useSavedDraft: false },
    };
    let plan;
    try { plan = publicationPlan(state.selected, choices[action], dirty(state)); }
    catch (error) { announce(state, error.message, true); return; }
    const label = { public: "Make public", upcoming: "Add to Upcoming", changes: "Publish changes", private: "Hide from members", date: "Update Upcoming date" }[action];
    state.preview = { plan, trigger, label };
    const { ui } = state;
    ui.previewTitle.textContent = label;
    ui.confirm.textContent = label;
    ui.previewFeedback.textContent = "";
    ui.previewContent.replaceChildren();
    ui.previewContent.append(el("p", "studio-preview-note", plan.input.visibility === "private"
      ? "This Veiling will no longer appear in member views. Its saved draft remains in the Studio."
      : plan.input.useSavedDraft ? "Members will see this saved draft after you confirm." : "This moves the existing member version. Your draft edits are not included."));
    const card = el("div", "studio-preview-card");
    if (plan.content.artworkUrl) card.append(artwork(plan.content.artworkUrl, plan.content.name));
    const content = el("div");
    content.append(el("h4", "", plan.content.name));
    if (plan.content.number != null) content.append(el("p", "studio-note", "Veiling " + String(plan.content.number).padStart(3, "0")));
    content.append(el("p", "studio-preview-description", plan.content.description || "No description added."));
    if (plan.content.rarity) content.append(el("p", "studio-note", "Rarity: " + plan.content.rarity));
    if (plan.content.edition) content.append(el("p", "studio-note", "Edition: " + plan.content.edition));
    if (plan.input.visibility === "upcoming") content.append(el("p", "studio-preview-timing", plan.input.releaseDate ? "Announced date: " + plan.input.releaseDate : "Coming soon"));
    card.append(content); ui.previewContent.append(card);
    ui.previewContent.append(el("p", "studio-note", "Public and Upcoming are visible only to signed-in members. Dates never publish a Veiling automatically."));
    updateControls(state);
    ui.dialog.showModal();
    ui.cancel.focus();
  }
  async function publish(state) {
    if (!active(state) || state.busy || !state.preview) return;
    const { plan } = state.preview;
    if (dirty(state) || state.selected?.id !== plan.input.id || state.selected.revision !== plan.input.revision) {
      state.ui.dialog.close(); announce(state, "The saved draft changed. Review a fresh preview before publishing.", true); return;
    }
    state.busy = true; updateControls(state);
    state.ui.previewFeedback.textContent = "Saving member visibility…";
    try {
      const row = await service.publishVeiling(plan.input);
      if (!active(state)) return;
      upsert(state, row);
      state.ui.dialog.close();
      state.preview = null;
      state.dateMode = row.publication?.releaseDate ? "date" : "coming-soon";
      state.releaseDate = row.publication?.releaseDate || "";
      renderEditor(state);
      announce(state, row.publication ? (plan.input.useSavedDraft ? "The saved draft is now published for members." : "Member visibility updated. Draft content was not published.") : "Hidden from member views. Your draft remains saved.");
      notify(row);
    } catch (error) {
      if (!active(state)) return;
      state.conflict = ["STALE_REVISION", "REVISION_REQUIRED", "PUBLICATION_REQUIRED"].includes(error?.code);
      if (state.conflict) { state.ui.dialog.close(); announce(state, errorText(error), true); }
      else state.ui.previewFeedback.textContent = errorText(error);
    } finally {
      if (active(state)) { state.busy = false; renderList(state); updateControls(state); }
    }
  }
  async function load(state, selectId = null) {
    if (!active(state)) return;
    readRequest?.abort();
    const controller = new AbortController(); readRequest = controller;
    const sequence = ++readSequence;
    state.loading = true; updateControls(state);
    state.ui.listFeedback.textContent = "Loading created Veilings…";
    const valid = () => active(state) && sequence === readSequence && !controller.signal.aborted;
    try {
      const rows = await service.listAdminVeilings({ signal: controller.signal });
      if (!valid()) return;
      state.rows = rows;
      state.ui.listFeedback.textContent = "";
      if (selectId) {
        const row = rows.find(item => item.id === selectId);
        if (row) select(state, row, true);
        else {
          state.selected = null; state.ui.editor.replaceChildren(el("p", "studio-empty", "This Veiling is no longer available."));
          state.ui.form = null; state.ui.fields = null; state.ui.file = null; state.ui.editorFeedback = null;
        }
      }
      renderList(state);
    } catch (error) {
      if (!valid()) return;
      state.ui.listFeedback.textContent = errorText(error);
      const retry = button("Try again", "studio-retry");
      retry.addEventListener("click", () => void load(state, selectId));
      state.ui.list.replaceChildren(retry);
    } finally {
      if (valid()) { state.loading = false; updateControls(state); }
    }
  }
  function open({ identity }) {
    if (current?.identity === identity) return current.ready;
    reset();
    if (!identity || getSession() !== identity) return Promise.resolve();
    root.classList.add("veiling-studio");
    const state = { identity, rows: [], selected: null, creating: false, busy: false, loading: false, conflict: false,
      filter: "all", search: "", dateMode: "coming-soon", releaseDate: "", preview: null, ui: {} };
    current = state;
    const ui = state.ui;
    const toolbar = el("div", "studio-toolbar");
    toolbar.append(el("p", "studio-note", "Create privately, then choose exactly what members see."));
    ui.create = button("Create Veiling", "studio-create", "outlined-button studio-primary");
    ui.create.addEventListener("click", () => select(state, null)); toolbar.append(ui.create);
    const layout = el("div", "studio-layout");
    const library = el("section", "studio-library"); library.setAttribute("aria-labelledby", "studio-created-title");
    const libraryHeading = el("div", "studio-library-heading");
    const title = el("h3", "", "Created Veilings"); title.id = "studio-created-title";
    ui.count = el("span", "studio-note"); libraryHeading.append(title, ui.count);
    const search = field("Search created Veilings", "studio-search", { type: "search", maxLength: 150 }); ui.search = search.input;
    ui.search.placeholder = "Name, number, or ID";
    ui.search.addEventListener("input", () => { state.search = ui.search.value; renderList(state); });
    const filters = el("div", "studio-filters"); filters.setAttribute("role", "group"); filters.setAttribute("aria-label", "Filter created Veilings");
    ui.filters = [];
    for (const [value, label] of [["all", "All"], ["draft", "Drafts"], ["upcoming", "Upcoming"], ["public", "Public"]]) {
      const node = button(label, "", "studio-filter"); node.dataset.filter = value;
      node.setAttribute("aria-pressed", String(value === state.filter));
      node.addEventListener("click", () => { state.filter = value; renderList(state); }); filters.append(node); ui.filters.push(node);
    }
    ui.list = el("div", "studio-list"); ui.list.id = "studio-list";
    ui.listFeedback = feedback("studio-list-feedback");
    library.append(libraryHeading, search.wrapper, filters, el("p", "studio-filter-hint", "Drafts includes unpublished Veilings and saved changes waiting to publish."), ui.listFeedback, ui.list);
    ui.editor = el("section", "studio-editor"); ui.editor.id = "studio-editor";
    ui.editor.append(el("h3", "", "Your next Veiling starts here"), el("p", "studio-empty", "Create a Veiling or select one from the list to work on its draft."));
    layout.append(library, ui.editor);
    ui.dialog = el("dialog", "modal studio-publish-dialog"); ui.dialog.id = "studio-publish-dialog";
    ui.dialog.setAttribute("aria-labelledby", "studio-preview-title");
    ui.previewTitle = el("h3"); ui.previewTitle.id = "studio-preview-title";
    ui.previewContent = el("div", "studio-preview-content");
    ui.previewFeedback = feedback("studio-publish-feedback");
    const actions = el("div", "studio-preview-actions");
    ui.cancel = button("Keep editing", "studio-publish-cancel");
    ui.confirm = button("Publish", "studio-publish-confirm", "outlined-button studio-primary");
    ui.cancel.addEventListener("click", () => { if (!state.busy) ui.dialog.close(); });
    ui.confirm.addEventListener("click", () => void publish(state));
    ui.dialog.addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
    ui.dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    ui.dialog.addEventListener("close", () => {
      const trigger = state.preview?.trigger; state.preview = null;
      if (active(state) && trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    });
    actions.append(ui.cancel, ui.confirm);
    ui.dialog.append(ui.previewTitle, ui.previewContent, ui.previewFeedback, actions);
    root.replaceChildren(toolbar, layout, ui.dialog);
    state.ready = load(state);
    return state.ready;
  }
  return Object.freeze({ open, reset });
}
