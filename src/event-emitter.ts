// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class EventEmitter<T extends Record<string, (...args: any[]) => void>> {
  private _listeners: Partial<{ [K in keyof T]: T[K][] }> = {};

  on<K extends keyof T>(event: K, listener: T[K]): void {
    (this._listeners[event] ||= []).push(listener);
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    const list = this._listeners[event];
    if (list) {
      this._listeners[event] = list.filter((l) => l !== listener);
    }
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    for (const listener of this._listeners[event] || []) {
      listener(...args);
    }
  }
}
