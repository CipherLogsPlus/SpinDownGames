import { el } from "./views.js";
import { icon } from "./icons.js";
import { getDashboardStats } from "../domain/collection.js";

export function renderHomeHub(snapshot) {
  const fragment = document.createDocumentFragment();
  const heading = el("h2", "hub-title", "Your Spinarium");
  heading.id = "hub-title";
  fragment.append(heading);
  const choices = el("div", "hub-choices");
  for (const [name, description, href, emblem] of [
    ["My Collection", `${getDashboardStats(snapshot).veilingsOwned} Veilings owned`, "#collection?filter=owned", "cards"],
    ["Explore Veilings", "Uncollected Veilings and upcoming releases", "#explore?filter=discovered", "spark"],
  ]) {
    const choice = el("a", "hub-choice");
    choice.href = href;
    const badge = el("span", "hub-choice-icon");
    badge.append(icon(emblem));
    choice.append(badge, el("h3", "", name), el("p", "", description));
    choices.append(choice);
  }
  fragment.append(choices);
  return fragment;
}
