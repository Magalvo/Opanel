// Test helper: a stand-in for the browser's EventSource, which jsdom does not have (WS-048).
// Pass it as `openSource`, or install it as the global with `vi.stubGlobal`.
import type { EventSourceLike } from "./use-project-events";

/** A stand-in for the browser's EventSource, driven by the test. */
export class FakeSource implements EventSourceLike {
  static readonly CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();

  /** When set, every new source opens on its own, as a working stream would. */
  static autoOpen = false;

  constructor(readonly url: string) {
    FakeSource.all.push(this);
    if (FakeSource.autoOpen) {
      queueMicrotask(() => {
        this.open();
      });
    }
  }

  /** The source opened last. */
  static latest(): FakeSource {
    const source = FakeSource.all.at(-1);
    if (!source) throw new Error("no event source was opened");
    return source;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  send(type: string, data: unknown): void {
    this.emit(type, new MessageEvent(type, { data: JSON.stringify(data) }));
  }

  /** The stream ended; the browser retries by itself (`retry: 3000`). */
  drop(): void {
    this.readyState = 0;
    this.emit("error", new Event("error"));
  }

  /** A reconnect was refused (401, 429…): the browser gives up on this source. */
  refuse(): void {
    this.readyState = 2;
    this.emit("error", new Event("error"));
  }
}
