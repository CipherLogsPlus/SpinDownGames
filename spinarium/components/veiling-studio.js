import { el } from "./views.js";
import { validReleaseDate } from "../domain/showcase.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const CONFLICT_CODES = ["STALE_REVISION", "REVISION_REQUIRED", "PUBLICATION_REQUIRED", "DRAFT_NOT_TRASHABLE", "DRAFT_TRASHED", "DRAFT_NOT_TRASHED"];
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
  if (row.trashedAt) throw new Error("Restore this draft from Trash before changing member visibility.");
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

/** The confirmation names the saved record and captures its exact revision. */
export function draftTrashPlan(row, dirty = false) {
  if (dirty) throw new Error("Save or discard your draft changes before moving it to Trash.");
  if (!row?.id || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Save a draft first.");
  if (row.canTrash !== true || row.status !== "draft" || row.publication || row.trashedAt)
    throw new Error("Only unused drafts that have never been published can be moved to Trash.");
  return Object.freeze({ id: row.id, revision: row.revision, name: row.name });
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
  if (row.trashedAt) return "In Trash";
  return row.publication?.visibility === "public" ? "Public · members" : row.publication?.visibility === "upcoming" ? "Upcoming" : "Draft";
}
function errorText(error) {
  if (["STALE_REVISION", "REVISION_REQUIRED"].includes(error?.code)) return "This Veiling changed elsewhere. Discard edits and reload its saved draft before continuing.";
  if (error?.code === "NUMBER_IN_USE") return "That character number is already in use. Choose another number or leave it blank.";
  if (["ACCESS_DENIED", "AUTH_REQUIRED"].includes(error?.code)) return "Studio access is no longer available. Sign in again or return to your collection.";
  if (error?.code === "PUBLICATION_REQUIRED") return "The member version changed. Reload this Veiling before continuing.";
  if (error?.code === "DRAFT_NOT_TRASHABLE") return "This draft can no longer be moved to Trash. Only unused, never-published drafts are eligible. Reload before continuing.";
  if (error?.code === "DRAFT_TRASHED") return "This draft was moved to Trash elsewhere. Reload the catalog and open Trash to restore it.";
  if (error?.code === "DRAFT_NOT_TRASHED") return "This draft is no longer in Trash. Reload the catalog to see its current state.";
  if (error?.code === "ARTWORK_UNAVAILABLE") return "Artwork storage is not configured. Clear the selected artwork to save a text-only draft.";
  return "The request could not be completed. Try again; no further changes have been confirmed.";
}

export function createVeilingStudio({ root, service, getSession, onChanged = () => {} }) {
  let current = null;
  let readRequest = null;
  let readSequence = 0;
  const active = state => current === state && getSession() === state.identity;

  function reset() {
    const previous = current;
    cancelLeave();
    current = null;
    readSequence++;
    readRequest?.abort();
    previous?.artworkRequest?.abort();
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
  function hasPendingChanges() {
    return Boolean(current && active(current) && (dirty(current) || current.busy));
  }
  function cancelLeave() {
    current?.leave?.finish(false);
  }
  function canLeave() {
    const state = current;
    if (!state || !active(state)) return Promise.resolve(true);
    if (state.leave) return state.leave.promise;
    if (state.busy) {
      announce(state, "Wait for the current action to finish before leaving the Studio.", true);
      return Promise.resolve(false);
    }
    if (!dirty(state)) return Promise.resolve(true);
    const trigger = document.activeElement;
    const dialog = el("dialog", "modal studio-publish-dialog");
    dialog.id = "studio-leave-dialog";
    dialog.setAttribute("aria-labelledby", "studio-leave-title");
    const title = el("h3", "", "Save your draft before leaving?"); title.id = "studio-leave-title";
    const status = feedback("studio-leave-feedback");
    const actions = el("div", "studio-preview-actions");
    const keep = button("Keep editing", "studio-leave-keep");
    const discard = button("Discard changes", "studio-leave-discard");
    const saveButton = button("Save draft and leave", "studio-leave-save", "outlined-button studio-primary");
    saveButton.disabled = state.conflict;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const finish = allowed => {
      if (state.leave?.dialog !== dialog) return;
      state.leave = null;
      dialog.close(); dialog.remove();
      if (!allowed && active(state)) {
        const focus = trigger?.isConnected && !trigger.closest("[hidden]") ? trigger : state.ui.fields?.name;
        focus?.focus({ preventScroll: true });
      }
      resolve(allowed);
    };
    state.leave = { promise, finish, dialog };
    keep.addEventListener("click", () => finish(false));
    discard.addEventListener("click", () => {
      if (state.busy) return;
      select(state, state.selected, true);
      finish(true);
    });
    saveButton.addEventListener("click", async () => {
      if (!state.ui.form.checkValidity()) {
        status.textContent = "Keep editing and complete the draft fields before saving.";
        keep.focus();
        return;
      }
      keep.disabled = discard.disabled = saveButton.disabled = true;
      status.textContent = "Saving draft…";
      const saved = await save(state);
      if (state.leave?.dialog !== dialog) return;
      if (saved) finish(true);
      else {
        status.textContent = state.ui.editorFeedback?.textContent || "Your draft could not be saved. Keep editing or discard the changes.";
        keep.disabled = discard.disabled = false;
        saveButton.disabled = state.conflict;
        keep.focus();
      }
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!state.busy) finish(false); });
    dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    actions.append(keep, discard, saveButton);
    dialog.append(title, el("p", "studio-preview-note", "Your unsaved text and selected artwork will be lost if you discard them. Saving keeps a private draft and does not publish it."), status, actions);
    root.append(dialog);
    dialog.showModal();
    keep.focus();
    return promise;
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
    ui.confirm.disabled = state.busy;
    ui.cancel.disabled = state.busy;
    if (ui.restore) {
      ui.restore.disabled = state.busy || state.loading || state.conflict;
      ui.restore.textContent = state.busy ? "Restoring…" : "Restore draft";
      ui.discard.hidden = !state.conflict;
      ui.discard.disabled = state.busy || state.loading;
    }
    if (!ui.form) return;
    const unsaved = dirty(state);
    ui.fieldset.disabled = state.busy || state.loading;
    ui.save.disabled = state.busy || state.loading || state.conflict || (state.artworkAvailable === false && Boolean(ui.file.files?.length));
    ui.save.textContent = state.busy && !state.preview ? "Saving…" : "Save Draft";
    ui.discard.hidden = !unsaved && !state.conflict;
    ui.discard.disabled = state.busy || state.loading;
    ui.discard.textContent = state.conflict ? "Discard edits and reload" : "Discard changes";
    ui.clearFile.hidden = !ui.file.files?.length;
    ui.clearFile.disabled = state.busy || state.loading;
    ui.file.disabled = state.artworkAvailable === false;
    ui.artworkHint.textContent = state.artworkAvailable === false
      ? "Artwork storage is not configured. You can still save text-only drafts. Existing saved artwork is kept."
      : state.artworkProbeFailed ? "Artwork storage could not be checked. You can save text-only drafts or try an upload. PNG, JPEG or WebP · up to 8 MB."
        : "PNG, JPEG or WebP · up to 8 MB. Artwork is saved to the draft first.";
    ui.draftState.textContent = unsaved ? "Unsaved changes" : state.selected ? "Saved draft" : "Not saved yet";
    const blocked = state.busy || state.loading || state.conflict || unsaved || !state.selected;
    if (ui.trash) ui.trash.disabled = blocked;
    if (ui.trashHint) ui.trashHint.textContent = unsaved ? "Save or discard your draft changes before moving it to Trash."
      : state.conflict ? "Reload the saved draft before moving it to Trash."
        : "Move this unused, never-published draft to Trash. You can restore it later.";
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
    if (!rows.length) ui.list.append(el("p", "studio-empty", state.rows.length ? "No Veilings match this view."
      : state.filter === "trash" ? "Trash is empty. Trashed drafts can be restored here." : "No Veilings created yet. Start with a name."));
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
    (state.ui.fields?.name || state.ui.restore)?.focus({ preventScroll: true });
  }

  function clearEditor(state, message = "Create a Veiling or select one from the list to work on its draft.") {
    const { ui } = state;
    state.selected = null;
    state.creating = false;
    state.conflict = false;
    ui.form = ui.fields = ui.file = ui.editorFeedback = ui.restore = ui.trash = ui.trashHint = null;
    ui.editor.replaceChildren(el("h3", "", state.filter === "trash" ? "Drafts in Trash" : "Your next Veiling starts here"), el("p", "studio-empty", message));
  }
  function renderTrashedEditor(state) {
    const { ui, selected } = state;
    ui.form = ui.fields = ui.file = ui.trash = ui.trashHint = null;
    const heading = el("div", "studio-editor-heading");
    heading.append(el("h3", "", selected.name), el("span", "studio-badge", "In Trash"));
    ui.editor.append(heading, el("p", "studio-note", "This saved draft is in Trash. Its details and artwork are kept. Restore it before editing, uploading artwork, or publishing."));
    if (selected.character_number != null) ui.editor.append(el("p", "studio-note", `Character number ${selected.character_number} stays reserved while this draft is in Trash.`));
    if (selected.rarity) ui.editor.append(el("p", "studio-note", "Rarity: " + selected.rarity));
    if (selected.edition) ui.editor.append(el("p", "studio-note", "Edition: " + selected.edition));
    if (selected.artworkUrl) ui.editor.append(artwork(selected.artworkUrl, selected.name));
    ui.editor.append(el("p", "studio-preview-description", selected.description || "No description added."));
    const actions = el("div", "studio-editor-actions");
    ui.restore = button("Restore draft", "studio-restore", "outlined-button studio-primary");
    ui.restore.addEventListener("click", () => void restore(state));
    ui.discard = button("Reload catalog", "studio-discard");
    ui.discard.addEventListener("click", () => { if (!state.busy && !state.loading) void load(state, selected.id); });
    actions.append(ui.restore, ui.discard);
    ui.editorFeedback = feedback("studio-editor-feedback");
    ui.editor.append(actions, ui.editorFeedback);
    updateControls(state);
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
    ui.restore = ui.trash = ui.trashHint = null;
    if (state.selected?.trashedAt) { renderTrashedEditor(state); return; }
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
    ui.artworkHint = artHint;
    artHint.id = "studio-artwork-hint"; ui.file.setAttribute("aria-describedby", artHint.id);
    art.wrapper.append(artHint);
    if (state.selected?.artworkUrl) art.wrapper.append(artwork(state.selected.artworkUrl, state.selected.name));
    ui.clearFile = button("Clear selected artwork", "studio-clear-artwork", "studio-text-button");
    ui.clearFile.addEventListener("click", () => {
      if (state.busy || state.loading) return;
      ui.file.value = ""; updateControls(state);
      announce(state, "Selected artwork cleared. Existing saved artwork is unchanged.");
    });
    art.wrapper.append(ui.clearFile);
    ui.fieldset.append(name.wrapper, description.wrapper, details, art.wrapper);
    const actions = el("div", "studio-editor-actions");
    ui.save = button("Save Draft", "studio-save", "outlined-button studio-primary"); ui.save.type = "submit";
    ui.discard = button("Discard changes", "studio-discard");
    ui.discard.addEventListener("click", () => {
      if (state.busy || state.loading) return;
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
    if (state.selected?.canTrash) {
      const trashPanel = el("section", "studio-trash-actions");
      ui.trashHint = el("p", "studio-note"); ui.trashHint.id = "studio-trash-hint";
      ui.trash = button("Trash draft", "studio-trash");
      ui.trash.setAttribute("aria-describedby", ui.trashHint.id);
      ui.trash.addEventListener("click", () => previewTrash(state, ui.trash));
      trashPanel.append(ui.trashHint, ui.trash);
      ui.editor.append(trashPanel);
    }
    updateControls(state);
  }
  async function save(state) {
    if (!active(state) || state.busy || state.loading || state.conflict || state.selected?.trashedAt || !state.ui.form?.reportValidity()) return false;
    const input = values(state), file = state.ui.file.files?.[0] || null;
    if (file && state.artworkAvailable === false) { announce(state, errorText({ code: "ARTWORK_UNAVAILABLE" }), true); return false; }
    if (!input.name) { announce(state, "Enter a Veiling name.", true); state.ui.fields.name.focus(); return false; }
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
        state.artworkRequest?.abort(); state.artworkRequest = null;
        state.artworkAvailable = true; state.artworkProbeFailed = false;
        upsert(state, saved);
      }
      renderEditor(state);
      announce(state, saved.publication ? "Draft saved. Members still see the version you last published." : "Draft saved. It is not visible to members.");
      notify(saved);
      return true;
    } catch (error) {
      if (!active(state)) return;
      state.conflict = CONFLICT_CODES.includes(error?.code);
      if (error?.code === "ARTWORK_UNAVAILABLE") {
        state.artworkRequest?.abort(); state.artworkRequest = null;
        state.artworkAvailable = false; state.artworkProbeFailed = false;
      }
      if (saved) {
        renderVisibility(state);
        announce(state, state.conflict ? "Draft saved, but artwork was not uploaded. Discard edits and reload before continuing."
          : error?.code === "ARTWORK_UNAVAILABLE" ? "Draft saved, but artwork storage is not configured. Clear the selected artwork to continue with a text-only draft. Existing saved artwork is unchanged."
          : "Draft saved, but artwork was not uploaded. Your selected file is still pending. Save Draft to retry, or clear the selected artwork.", true);
        notify(saved);
      } else announce(state, error?.code ? errorText(error) : error?.message?.startsWith("Choose ") || error?.message?.startsWith("The selected file") ? error.message : errorText(error), true);
      return false;
    } finally {
      if (active(state)) { state.busy = false; renderList(state); updateControls(state); }
    }
  }
  function preview(state, action, trigger) {
    if (!active(state) || state.busy || state.loading || state.conflict || state.preview || state.selected?.trashedAt) return;
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
    state.preview = { kind: "publication", plan, trigger, label };
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
    if (!active(state) || state.busy || !state.preview || state.preview.kind !== "publication" || state.selected?.trashedAt) return;
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
      state.conflict = CONFLICT_CODES.includes(error?.code);
      if (state.conflict) { state.ui.dialog.close(); announce(state, errorText(error), true); }
      else state.ui.previewFeedback.textContent = errorText(error);
    } finally {
      if (active(state)) { state.busy = false; renderList(state); updateControls(state); }
    }
  }
  function previewTrash(state, trigger) {
    if (!active(state) || state.busy || state.loading || state.conflict || state.preview) return;
    let plan;
    try { plan = draftTrashPlan(state.selected, dirty(state)); }
    catch (error) { announce(state, error.message, true); return; }
    state.preview = { kind: "trash", plan, trigger };
    const { ui } = state;
    ui.previewTitle.textContent = "Trash draft?";
    ui.confirm.textContent = "Trash draft";
    ui.cancel.textContent = "Keep editing";
    ui.previewFeedback.textContent = "";
    ui.previewContent.replaceChildren(el("h4", "studio-trash-name", plan.name),
      el("p", "studio-preview-note", "Move this saved draft to Trash? You can restore it later from the Trash filter. Its details and artwork are kept. Nothing is permanently deleted."));
    updateControls(state);
    ui.dialog.showModal();
    ui.cancel.focus();
  }
  async function trash(state) {
    if (!active(state) || state.busy || state.loading || state.conflict || state.preview?.kind !== "trash") return;
    const plan = state.preview.plan;
    if (dirty(state) || state.selected?.id !== plan.id || state.selected.revision !== plan.revision || !state.selected.canTrash) {
      state.ui.dialog.close();
      announce(state, "The saved draft changed. Review a fresh confirmation before moving it to Trash.", true);
      return;
    }
    state.busy = true; updateControls(state);
    state.ui.previewFeedback.textContent = "Moving draft to Trash…";
    try {
      const row = await service.trashVeiling({ id: plan.id, revision: plan.revision });
      if (!active(state)) return;
      state.ui.dialog.close(); state.preview = null;
      state.filter = "trash"; state.rows = [row]; state.search = ""; state.ui.search.value = "";
      select(state, row, true);
      notify(row);
      state.busy = false;
      await load(state, row.id);
      if (state.selected?.id === row.id && state.selected.trashedAt)
        announce(state, `“${plan.name}” moved to Trash. You can restore it here. Nothing was permanently deleted.`);
    } catch (error) {
      if (!active(state)) return;
      state.conflict = CONFLICT_CODES.includes(error?.code);
      if (state.conflict) { state.ui.dialog.close(); announce(state, errorText(error), true); }
      else state.ui.previewFeedback.textContent = errorText(error);
    } finally {
      if (active(state)) {
        state.busy = false; renderList(state); updateControls(state);
        if (!state.ui.dialog.open) (state.ui.restore || (state.conflict ? state.ui.discard : state.ui.trash))?.focus({ preventScroll: true });
      }
    }
  }
  async function restore(state) {
    if (!active(state) || state.busy || state.loading || state.conflict || !state.selected?.trashedAt) return;
    const selected = state.selected;
    state.busy = true; updateControls(state); announce(state, "Restoring draft…");
    try {
      const row = await service.restoreVeiling({ id: selected.id, revision: selected.revision });
      if (!active(state)) return;
      state.filter = "all"; state.rows = [row]; state.search = ""; state.ui.search.value = "";
      select(state, row, true);
      notify(row);
      state.busy = false;
      await load(state, row.id);
      if (state.selected?.id === row.id && !state.selected.trashedAt)
        announce(state, `“${row.name}” restored as a private draft.`);
    } catch (error) {
      if (!active(state)) return;
      state.conflict = CONFLICT_CODES.includes(error?.code);
      announce(state, errorText(error), true);
    } finally {
      if (active(state)) {
        state.busy = false; renderList(state); updateControls(state);
        (state.conflict ? state.ui.discard : state.ui.fields?.name || state.ui.restore)?.focus({ preventScroll: true });
      }
    }
  }
  async function load(state, selectId = null) {
    if (!active(state)) return;
    readRequest?.abort();
    const controller = new AbortController(); readRequest = controller;
    const sequence = ++readSequence;
    state.loading = true; updateControls(state);
    state.ui.listFeedback.textContent = "Loading created Veilings…";
    let timedOut = false, timer;
    const valid = () => active(state) && sequence === readSequence && (!controller.signal.aborted || timedOut);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true; controller.abort(); reject(new Error("Catalog read timed out."));
      }, 30000);
    });
    try {
      const rows = await Promise.race([service.listAdminVeilings({ signal: controller.signal, trashed: state.filter === "trash" }), deadline]);
      if (!valid()) return;
      state.rows = rows;
      state.ui.listFeedback.textContent = "";
      if (selectId) {
        const row = rows.find(item => item.id === selectId);
        if (row) select(state, row, true);
        else {
          clearEditor(state, state.filter === "trash"
            ? "This draft is no longer in Trash. Open All to find restored drafts."
            : "This Veiling is no longer available in this view. Open Trash to find trashed drafts.");
        }
      }
      renderList(state);
    } catch (error) {
      if (!valid()) return;
      state.ui.listFeedback.textContent = timedOut ? "The catalog took too long to load. Try again." : errorText(error);
      const retry = button("Try again", "studio-retry");
      retry.addEventListener("click", () => { if (active(state) && mayLeaveDraft(state)) void load(state, state.selected?.id); });
      // Keep recovery available if a confirmed mutation renders its saved row
      // after the subsequent catalog refresh fails.
      state.ui.listFeedback.append(" ", retry);
      state.ui.list.replaceChildren();
    } finally {
      clearTimeout(timer);
      if (valid()) {
        state.loading = false; updateControls(state);
        if (selectId && !state.busy && state.selected?.id === selectId)
          (state.ui.fields?.name || state.ui.restore)?.focus({ preventScroll: true });
      }
    }
  }
  async function checkArtworkStatus(state) {
    if (typeof service.getAdminArtworkStatus !== "function") return;
    const controller = new AbortController(); state.artworkRequest = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const result = await service.getAdminArtworkStatus({ signal: controller.signal });
      if (!active(state) || controller.signal.aborted || state.artworkRequest !== controller) return;
      state.artworkAvailable = result.available;
      state.artworkProbeFailed = false;
    } catch {
      if (!active(state) || state.artworkRequest !== controller) return;
      // This optional read must not prevent a draft save or authorize a write.
      state.artworkProbeFailed = true;
    } finally {
      clearTimeout(timer);
      if (active(state)) updateControls(state);
    }
  }
  function open({ identity }) {
    if (current?.identity === identity) return current.ready;
    reset();
    if (!identity || getSession() !== identity) return Promise.resolve();
    root.classList.add("veiling-studio");
    const state = { identity, rows: [], selected: null, creating: false, busy: false, loading: false, conflict: false,
      filter: "all", search: "", dateMode: "coming-soon", releaseDate: "", preview: null,
      artworkAvailable: null, artworkProbeFailed: false, artworkRequest: null, ui: {} };
    current = state;
    const ui = state.ui;
    const toolbar = el("div", "studio-toolbar");
    toolbar.append(el("p", "studio-note", "Create privately, then choose exactly what members see."));
    ui.create = button("Create Veiling", "studio-create", "outlined-button studio-primary");
    ui.create.addEventListener("click", () => {
      if (!active(state) || !mayLeaveDraft(state)) return;
      const fromTrash = state.filter === "trash";
      if (fromTrash) { state.filter = "all"; state.rows = []; }
      select(state, null, true);
      if (fromTrash) void load(state);
    }); toolbar.append(ui.create);
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
    for (const [value, label] of [["all", "All"], ["draft", "Drafts"], ["upcoming", "Upcoming"], ["public", "Public"], ["trash", "Trash"]]) {
      const node = button(label, "", "studio-filter"); node.dataset.filter = value;
      node.setAttribute("aria-pressed", String(value === state.filter));
      node.addEventListener("click", () => {
        if (!active(state) || state.busy || state.loading || state.filter === value) return;
        const differentCatalog = (state.filter === "trash") !== (value === "trash");
        if (differentCatalog && !mayLeaveDraft(state)) return;
        state.filter = value;
        if (differentCatalog) {
          state.rows = [];
          clearEditor(state, value === "trash" ? "Select a trashed draft to review or restore it. Nothing is permanently deleted." : undefined);
          renderList(state);
          void load(state);
        } else renderList(state);
      }); filters.append(node); ui.filters.push(node);
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
    ui.confirm.addEventListener("click", () => { if (state.preview?.kind === "trash") void trash(state); else void publish(state); });
    ui.dialog.addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
    ui.dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    ui.dialog.addEventListener("close", () => {
      const trigger = state.preview?.trigger; state.preview = null;
      if (active(state) && trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    });
    actions.append(ui.cancel, ui.confirm);
    ui.dialog.append(ui.previewTitle, ui.previewContent, ui.previewFeedback, actions);
    root.replaceChildren(toolbar, layout, ui.dialog);
    void checkArtworkStatus(state);
    state.ready = load(state);
    return state.ready;
  }
  return Object.freeze({ open, reset, canLeave, cancelLeave, hasPendingChanges });
}
