// The single in-page demo backend shared by every view.
import { createStore } from "./store.js";

export const store = createStore();

/** Cross-view navigation context (e.g. open a report or start a chat with one agent). */
export const handoff = { reportId: null, agentId: null };
export function go(route, context = {}) {
  Object.assign(handoff, context);
  window.location.hash = route;
}
